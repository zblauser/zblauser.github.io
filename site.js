/* ========================================
   Feed sources that are not GitHub.
   - dev.to           live, sends Access-Control-Allow-Origin: *
   - Hacker News      live, via the Algolia search API, also sends *
   - Discourse forums snapshotted server-side, read from feeds/*.json

   Every call is read-through cached in localStorage and falls back to the
   last good copy on failure, so a dead source degrades to slightly stale
   rather than to an empty page.

   GitHub lives in gh.js.
   ======================================== */

(function (global) {
	'use strict';

	// Handles that more than one place needs to agree on.
	const DOC = {
		name: 'Zachary Blauser',
		email: 'zacharymblauser@gmail.com',
		github: 'https://github.com/zblauser',
		site: 'https://zblauser.dev',
		x: 'https://x.com/parhelicsquare',
		devto: 'zblauser',
		ziggit: 'selectedambient',
		hnUser: 'selectedambient'
	};

	const DEVTO_CACHE_KEY = 'devto_cache_v1';
	const HN_CACHE_KEY = 'hn_cache_v1';
	const FORUM_CACHE_PREFIX = 'forum_cache_v1_';
	const HOUR_MS = 60 * 60 * 1000;

	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
			'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
		}[c]));
	}

	// --- CACHE ------------------------------------------------------------
	// Read-through with stale fallback: on a failed fetch we serve the last
	// known good data rather than leaving a section empty.

	function cacheRead(key, ttl) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (!parsed) return null;
			return { fresh: (Date.now() - parsed.fetchedAt) < ttl, data: parsed.data };
		} catch {
			return null;
		}
	}

	function cacheWrite(key, data) {
		try {
			localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }));
		} catch { /* quota or private mode - not fatal */ }
	}

	// --- DEV.TO -----------------------------------------------------------

	async function fetchDevtoArticles(username) {
		username = username || DOC.devto;
		const cached = cacheRead(DEVTO_CACHE_KEY, HOUR_MS);
		if (cached && cached.fresh) return cached.data || [];

		try {
			const res = await fetch(
				`https://dev.to/api/articles?username=${encodeURIComponent(username)}&per_page=10`);
			if (!res.ok) throw new Error('devto ' + res.status);
			const data = await res.json();
			const articles = Array.isArray(data) ? data.map(a => ({
				source: 'dev.to',
				repo: 'dev.to',
				title: a.title,
				url: a.url,
				time: a.published_at || a.created_at,
				tags: a.tag_list || []
			})) : [];
			cacheWrite(DEVTO_CACHE_KEY, articles);
			return articles;
		} catch {
			return (cached && cached.data) || [];
		}
	}

	// --- HACKER NEWS ------------------------------------------------------
	// The Algolia search API is the read path for HN and it does send
	// Access-Control-Allow-Origin: *, so this stays live client-side and
	// needs no snapshot. Stories and comments both come back; a comment
	// carries story_title instead of title.

	async function fetchHNPosts(user) {
		user = user || DOC.hnUser;
		const cached = cacheRead(HN_CACHE_KEY, HOUR_MS);
		if (cached && cached.fresh) return cached.data || [];

		try {
			const res = await fetch('https://hn.algolia.com/api/v1/search_by_date'
				+ `?tags=author_${encodeURIComponent(user)}&hitsPerPage=30`);
			if (!res.ok) throw new Error('hn ' + res.status);
			const data = await res.json();
			const posts = (Array.isArray(data.hits) ? data.hits : []).map(h => ({
				source: 'hn',
				repo: 'news.ycombinator.com',
				kind: h.title ? 'posted' : 'commented on',
				title: h.title || h.story_title || 'thread',
				url: `https://news.ycombinator.com/item?id=${h.objectID}`,
				time: h.created_at
			})).filter(p => p.time);
			cacheWrite(HN_CACHE_KEY, posts);
			return posts;
		} catch {
			return (cached && cached.data) || [];
		}
	}

	// --- DISCOURSE FORUMS -------------------------------------------------
	// Neither ziggit.dev nor users.rust-lang.org sends an
	// Access-Control-Allow-Origin header, so a browser cannot read them: the
	// request is blocked before the response is visible. tools/fetch_feeds.py
	// snapshots them in CI, where CORS does not apply, and commits
	// feeds/<key>.json for us to read same-origin.
	//
	// A missing or empty snapshot yields nothing, so a forum with no posts is
	// silently absent rather than shown as an error.

	async function fetchForumPosts(key) {
		const cacheKey = FORUM_CACHE_PREFIX + key;
		const cached = cacheRead(cacheKey, HOUR_MS);
		if (cached && cached.fresh) return cached.data || [];

		try {
			const res = await fetch(`feeds/${encodeURIComponent(key)}.json`);
			if (!res.ok) throw new Error('feed ' + res.status);
			const data = await res.json();
			const posts = Array.isArray(data.posts) ? data.posts : [];
			cacheWrite(cacheKey, posts);
			return posts;
		} catch {
			return (cached && cached.data) || [];
		}
	}

	global.Site = {
		DOC,
		escapeHtml: esc,
		fetchDevtoArticles,
		fetchHNPosts,
		fetchForumPosts
	};
})(window);
