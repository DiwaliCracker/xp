const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURATION ---
const TMDB_KEY = "05902896074695709d7763505bb88b4d&include_adult=true"; 
const M3U_URL = "https://raw.githubusercontent.com/DiwaliCracker/vtt1/main/index8.m3u";

const hashId = (s) => Math.abs(s.split('').reduce((a, b) => (((a << 5) - a) + b.charCodeAt(0)) | 0, 0)).toString();

function parseM3U(m3u) {
    const lines = m3u.trim().split('\n');
    const db = { movieCats: {}, seriesCats: {}, movies: {}, series: {}, streams: {} };
    let current = null;

    lines.forEach(line => {
        if (line.startsWith('#EXTINF')) {
            const tvgId = (line.match(/tvg-id="([^"]+)"/i) || [])[1] || "";
            const name = (line.match(/tvg-name="([^"]+)"/i) || [])[1] || "Unknown";
            const logo = (line.match(/tvg-logo="([^"]+)"/i) || [])[1] || "";
            const group = (line.match(/group-title="([^"]+)"/i) || [])[1] || "Default";
            const season = (line.match(/season="([^"]+)"/i) || [])[1];
            const episode = (line.match(/episode="([^"]+)"/i) || [])[1];
            const title = line.split(',')[1]?.trim() || name;
            current = { tvgId, name, logo, group, season, episode, title };
        } else if (line.startsWith('http') && current) {
            const catId = hashId(current.group);
            if (current.season || current.episode) {
                const sId = hashId(current.name);
                db.seriesCats[catId] = current.group;
                if (!db.series[sId]) db.series[sId] = { id: sId, name: current.name, category_id: catId, logo: current.logo, tmdbId: current.tvgId, seasons: {} };
                const sNum = current.season || "1";
                if (!db.series[sId].seasons[sNum]) db.series[sId].seasons[sNum] = [];
                const epId = hashId(line);
                db.series[sId].seasons[sNum].push({ id: epId, title: current.title, epNum: current.episode || "1", logo: current.logo, url: line });
                db.streams[epId] = line;
            } else {
                const mId = hashId(line);
                db.movieCats[catId] = current.group;
                db.movies[mId] = { id: mId, name: current.name, category_id: catId, logo: current.logo, tmdbId: current.tvgId, url: line };
                db.streams[mId] = line;
            }
            current = null;
        }
    });
    return db;
}

async function getTMDBDetails(id, type) {
    if (!TMDB_KEY || !id) return null;
    try {
        let tmdbId = id;
        if (id.startsWith('tt')) {
            const find = await axios.get(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`);
            const results = type === 'movie' ? find.data.movie_results : find.data.tv_results;
            if (results.length > 0) tmdbId = results[0].id; else return null;
        }
        const details = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=credits`);
        const data = details.data;
        return {
            id: tmdbId,
            plot: data.overview,
            rating: data.vote_average?.toFixed(1),
            cast: data.credits?.cast?.slice(0, 15).map(a => a.name).join(", "),
            director: data.credits?.crew?.find(c => c.job === 'Director')?.name || "N/A",
            genre: data.genres?.map(g => g.name).join(", "),
            backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : "",
            poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : ""
        };
    } catch (e) { return null; }
}

// --- EXPRESS ROUTES ---
app.get('/player_api.php', async (req, res) => {
    const { action, username, password, vod_id, series_id } = req.query;

    // Login Check
    if (username !== 'admin' || password !== 'admin123') {
        return res.json({ user_info: { auth: 0 } });
    }

    // Fetch M3U
    const m3uRes = await axios.get(M3U_URL);
    const db = parseM3U(m3uRes.data);

    if (!action) {
        return res.json({
            user_info: { username: "admin", password: "admin123", auth: 1, status: "Active", exp_date: "1922312400" },
            server_info: { url: req.hostname, port: "443", https_port: "443", server_protocol: "https" }
        });
    }

    if (action === 'get_vod_categories') return res.json(Object.entries(db.movieCats).map(([id, name]) => ({ category_id: id, category_name: name })));
    if (action === 'get_vod_streams') return res.json(Object.values(db.movies).map(m => ({ name: m.name, stream_id: m.id, category_id: m.category_id, container_extension: "mp4", stream_icon: m.logo })));
    
    if (action === 'get_vod_info') {
        const m = db.movies[vod_id];
        const tmdb = await getTMDBDetails(m.tmdbId, 'movie');
        return res.json({
            info: { name: m.name, plot: tmdb?.plot, rating: tmdb?.rating, cast: tmdb?.cast, director: tmdb?.director, movie_image: tmdb?.backdrop || m.logo, cover_big: tmdb?.poster || m.logo },
            movie_data: { stream_id: m.id, container_extension: "mp4" }
        });
    }

    if (action === 'get_series_categories') return res.json(Object.entries(db.seriesCats).map(([id, name]) => ({ category_id: id, category_name: name })));
    if (action === 'get_series') return res.json(Object.values(db.series).map(s => ({ name: s.name, series_id: s.id, category_id: s.category_id, cover: s.logo })));
    
    if (action === 'get_series_info') {
        const s = db.series[series_id];
        const tmdb = await getTMDBDetails(s.tmdbId, 'tv');
        const episodes = {};
        
        for (const n in s.seasons) {
            let seasonData = null;
            try {
                const sres = await axios.get(`https://api.themoviedb.org/3/tv/${tmdb.id}/season/${n}?api_key=${TMDB_KEY}`);
                seasonData = sres.data;
            } catch (e) {}

            episodes[n] = s.seasons[n].map(e => {
                const epMeta = seasonData?.episodes?.find(x => x.episode_number == e.epNum);
                return {
                    id: e.id, episode_num: e.epNum, title: e.title, container_extension: "mp4",
                    info: { movie_image: e.logo || (epMeta?.still_path ? `https://image.tmdb.org/t/p/w500${epMeta.still_path}` : "") || tmdb?.backdrop || "", plot: epMeta?.overview || tmdb?.plot },
                    season: parseInt(n)
                };
            });
        }
        return res.json({ seasons: Object.keys(s.seasons).map(n => ({ season_number: parseInt(n) })), info: { name: s.name, plot: tmdb?.plot, cast: tmdb?.cast, cover: tmdb?.poster || s.logo }, episodes });
    }

    res.json([]);
});

// Stream Redirects
app.get('/:type/:id.:ext', (req, res) => {
    // This is a simplified redirect for the actual .mp4 links
    res.redirect(`https://your-logic-here.com`); 
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
