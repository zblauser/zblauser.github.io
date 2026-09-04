/* ========================================
   Shared site helpers — ZB-1 datasheet
   - Title block + table of contents + document footer injection
   - notes.json loader
   - dev.to feed
   - ziggit.dev feed (Discourse)
   ======================================== */

(function (global) {
	'use strict';

	/* ==========================================================
	   DOCUMENT IDENTITY — edit here, propagates to every page.
	   ========================================================== */
	const DOC = {
		part: 'ZB-1',
		name: 'ZACHARY BLAUSER',
		fn: 'SYSTEMS PROGRAMMER',
		rev: '2026.4',
		status: 'PRELIMINARY',
		email: 'zacharymblauser@gmail.com',
		github: 'https://github.com/zblauser',
		site: 'https://zblauser.dev',
		x: 'https://x.com/parhelicsquare',
		ziggit: 'selectedambient',
		hn: 'https://news.ycombinator.com/user?id=selectedambient',
		hnUser: 'selectedambient'
	};

	/* ==========================================================
	   SECTION MAP — the site is one document; each page is a
	   numbered section. `sec` renders in the table of contents.
	   ========================================================== */
	const NAV_PAGES = [
		{ file: 'index.html',    label: 'COVER',    sec: '—'   },
		{ file: 'projects.html', label: 'PROJECTS', sec: '2.0' },
		{ file: 'about.html',    label: 'ABOUT',    sec: '3.0' },
		{ file: 'now.html',      label: 'NOW',      sec: '4.0' },
		{ file: 'log.html',      label: 'LOG',      sec: '5.0' },
		{ file: 'uses.html',     label: 'TOOLS',    sec: '6.0' }
	];

	const NOTES_CACHE_KEY = 'notes_cache_v1';
	const NOTES_CACHE_TTL_MS = 10 * 60 * 1000;      // 10 minutes
	const DEVTO_CACHE_KEY = 'devto_cache_v1';
	const DEVTO_CACHE_TTL_MS = 60 * 60 * 1000;      // 1 hour
	const HN_CACHE_KEY = 'hn_cache_v1';
	const HN_CACHE_TTL_MS = 60 * 60 * 1000;         // 1 hour

	function currentFile() {
		const path = window.location.pathname;
		const seg = path.substring(path.lastIndexOf('/') + 1);
		return seg || 'index.html';
	}

	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
			'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
		}[c]));
	}

	// ISO-ish date for the title block. Datasheets date by day.
	function docDate(d) {
		d = d || new Date();
		const p = n => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}

	// --- TITLE BLOCK ------------------------------------------------------

	function injectTitleBlock(opts) {
		opts = opts || {};
		const host = document.querySelector('.title-block');
		if (!host) return;

		const here = currentFile();
		const idx = NAV_PAGES.findIndex(p => p.file === here);
		const pageNo = idx >= 0 ? idx + 1 : 1;
		const sheetTitle = opts.title || (idx >= 0 ? NAV_PAGES[idx].label : 'COVER');
		// A sheet can declare its own status; the 404 is a fault, not a draft.
		const status = opts.docStatus || DOC.status;

		host.innerHTML = `
			<div class="tb-name">
				<h1>${esc(DOC.name)}</h1>
				<span class="tb-part">${esc(DOC.part)}</span>
				<span class="tb-fn">${esc(DOC.fn)}</span>
			</div>
			<div class="tb-cells">
				<div class="tb-cell"><span class="lbl">Document</span><span class="val">${esc(DOC.part)}-DS</span></div>
				<div class="tb-cell"><span class="lbl">Sheet</span><span class="val">${esc(sheetTitle)}</span></div>
				<div class="tb-cell"><span class="lbl">Revision</span><span class="val">${esc(DOC.rev)}</span></div>
				<div class="tb-cell"><span class="lbl">Issued</span><span class="val">${esc(docDate())}</span></div>
				<div class="tb-cell"><span class="lbl">Status</span><span class="val caution">${esc(status)}</span></div>
			</div>
		`;

		// Page number is footer business, but derived here.
		host.dataset.pageNo = String(pageNo);
		host.dataset.pageCount = String(NAV_PAGES.length);
	}

	// --- TABLE OF CONTENTS (nav) -----------------------------------------

	function injectToc() {
		const host = document.querySelector('.toc');
		if (!host) return;
		const here = currentFile();

		let html = '';
		for (const page of NAV_PAGES) {
			const cur = page.file === here ? ' aria-current="page"' : '';
			html += `<a href="${page.file}"${cur}><span class="sec">${esc(page.sec)}</span>${esc(page.label)}</a>`;
		}
		html += `<a href="mailto:${esc(DOC.email)}" class="contact-cta"><span class="sec">7.0</span>CONTACT</a>`;
		host.innerHTML = html;
	}

	// --- DOCUMENT FOOTER --------------------------------------------------

	function injectFooter(opts) {
		opts = opts || {};
		const tb = document.querySelector('.title-block');
		const pageNo = (tb && tb.dataset.pageNo) || '1';
		const pageCount = (tb && tb.dataset.pageCount) || String(NAV_PAGES.length);

		const links = [
			`<a href="${esc(DOC.github)}" target="_blank" rel="noopener">github</a>`,
			DOC.x ? `<a href="${esc(DOC.x)}" target="_blank" rel="noopener">x</a>` : '',
			`<a href="mailto:${esc(DOC.email)}">mail</a>`
		].filter(Boolean).join('<span class="foot-sep"> · </span>');

		const footer = document.createElement('footer');
		footer.className = 'doc-footer';
		footer.innerHTML = `
			<span>${esc(DOC.part)}-DS<span class="foot-sep"> · </span>Rev. ${esc(DOC.rev)}<span class="foot-sep"> · </span>Page ${esc(pageNo)} of ${esc(pageCount)}</span>
			<span>${links}</span>
			<span class="foot-status">${esc(opts.status || '© ' + new Date().getFullYear() + ' Zachary Blauser')}</span>
		`;

		const sheet = document.querySelector('.sheet');
		(sheet || document.body).appendChild(footer);
	}

	// Convenience: every page calls this one function.
	function initDoc(opts) {
		injectTitleBlock(opts);
		injectToc();
		injectFooter(opts);
		injectBarcodes();
	}

	// --- BARCODE ----------------------------------------------------------
	// Code 39. Chosen over Code 128 because it is self-checking and needs no
	// checksum, so what renders here actually scans to the document number
	// rather than being decorative stripes.
	//
	// Each character is nine elements, alternating bar/space starting with a
	// bar. 'n' is one unit wide, 'w' is three. Exactly three elements per
	// character are wide, one of which is a space.

	const CODE39 = {
		'0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
		'4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
		'8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
		'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw',
		'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn',
		'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn', 'K': 'wnnnnnnww', 'L': 'nnwnnnnww',
		'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn',
		'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
		'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw',
		'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
		'-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
		'/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn'
	};

	// Returns an SVG string, or '' when the text cannot be encoded.
	function barcodeSVG(text, opts) {
		opts = opts || {};
		const narrow = opts.narrow || 2;
		const wide = narrow * 3;
		const height = opts.height || 34;
		const quiet = narrow * 10;

		const chars = ('*' + String(text).toUpperCase() + '*').split('');
		for (const c of chars) {
			if (!CODE39[c]) return '';
		}

		const bars = [];
		let x = quiet;

		chars.forEach((c, ci) => {
			const pattern = CODE39[c];
			for (let i = 0; i < 9; i++) {
				const w = pattern[i] === 'w' ? wide : narrow;
				if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
				x += w;
			}
			// Inter-character gap, omitted after the final character.
			if (ci < chars.length - 1) x += narrow;
		});

		const total = x + quiet;
		return `<svg class="barcode" viewBox="0 0 ${total} ${height}" `
			+ `preserveAspectRatio="xMinYMid meet" role="img" `
			+ `aria-label="Barcode: ${esc(text)}">${bars.join('')}</svg>`;
	}

	// Fill any [data-barcode] element. Value comes from the attribute, or
	// falls back to the document number.
	function injectBarcodes() {
		document.querySelectorAll('[data-barcode]').forEach(el => {
			const value = el.getAttribute('data-barcode') || `${DOC.part}-DS-${DOC.rev}`;
			const svg = barcodeSVG(value);
			if (!svg) return;
			el.innerHTML = `${svg}<span class="barcode-text">${esc(value)}</span>`;
			el.classList.add('barcode-block');
		});
	}

	// --- FAULT ------------------------------------------------------------
	// A source being unreachable is a real condition, so the page states it
	// at full width instead of leaving a grey dash.

	function fault(message, code) {
		return `<div class="system-fault" role="status">
			<span class="fault-head">Fault</span>
			${esc(message)}
			${code ? `<span class="fault-code">${esc(code)}</span>` : ''}
		</div>`;
	}

	// --- CACHE HELPER -----------------------------------------------------
	// Read-through cache with stale fallback. On a failed fetch we render the
	// last known good data rather than leaving a row stuck on "fetching".

	function cacheRead(key, ttl) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (!parsed) return null;
			const fresh = (Date.now() - parsed.fetchedAt) < ttl;
			return { fresh, data: parsed.data };
		} catch {
			return null;
		}
	}

	function cacheWrite(key, data) {
		try {
			localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }));
		} catch { /* quota or private mode — not fatal */ }
	}

	// --- NOTES ------------------------------------------------------------

	async function fetchNotes(url) {
		url = url || 'notes.json';

		const cached = cacheRead(NOTES_CACHE_KEY, NOTES_CACHE_TTL_MS);
		if (cached && cached.fresh) return cached.data || [];

		try {
			const res = await fetch(`${url}?_=${Date.now()}`);
			if (!res.ok) throw new Error('notes fetch failed');
			const data = await res.json();
			const notes = Array.isArray(data) ? data : (Array.isArray(data.notes) ? data.notes : []);
			cacheWrite(NOTES_CACHE_KEY, notes);
			return notes;
		} catch {
			return (cached && cached.data) || [];
		}
	}

	// --- DEV.TO -----------------------------------------------------------

	async function fetchDevtoArticles(username) {
		username = username || 'zblauser';

		const cached = cacheRead(DEVTO_CACHE_KEY, DEVTO_CACHE_TTL_MS);
		if (cached && cached.fresh) return cached.data || [];

		try {
			const res = await fetch(`https://dev.to/api/articles?username=${encodeURIComponent(username)}&per_page=10`);
			if (!res.ok) throw new Error('devto fetch failed');
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

	// --- DISCOURSE FORUMS -------------------------------------------------
	// --- HACKER NEWS -----------------------------------------------------
	// The Algolia search API is the read path for HN and it does send
	// Access-Control-Allow-Origin: *, so this stays live client-side and
	// needs no snapshot in feeds/. Stories and comments both come back;
	// a comment carries story_title instead of title.

	async function fetchHNPosts(user) {
		user = user || DOC.hnUser || 'selectedambient';

		const cached = cacheRead(HN_CACHE_KEY, HN_CACHE_TTL_MS);
		if (cached && cached.fresh) return cached.data || [];

		try {
			const url = 'https://hn.algolia.com/api/v1/search_by_date'
				+ `?tags=author_${encodeURIComponent(user)}&hitsPerPage=30`;
			const res = await fetch(url);
			if (!res.ok) throw new Error('hn fetch failed');
			const data = await res.json();
			const hits = Array.isArray(data.hits) ? data.hits : [];
			const posts = hits.map(h => ({
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

	// Neither ziggit.dev nor users.rust-lang.org sends an
	// Access-Control-Allow-Origin header, so the browser blocks a direct
	// fetch before the response is readable. GitHub and dev.to both send `*`,
	// which is why only these two need a snapshot. tools/fetch_feeds.py runs
	// in CI and commits feeds/<key>.json; we read those same-origin.
	//
	// A snapshot that is missing or empty simply yields nothing, so a forum
	// with no posts yet is silently absent rather than shown as an empty
	// section.

	const FORUM_CACHE_PREFIX = 'forum_cache_v1_';
	const FORUM_CACHE_TTL_MS = 60 * 60 * 1000;

	async function fetchForumPosts(key) {
		const cacheKey = FORUM_CACHE_PREFIX + key;
		const cached = cacheRead(cacheKey, FORUM_CACHE_TTL_MS);
		if (cached && cached.fresh) return cached.data || [];

		try {
			const res = await fetch(`feeds/${encodeURIComponent(key)}.json`);
			if (!res.ok) throw new Error(`feed ${res.status}`);
			const data = await res.json();
			const posts = Array.isArray(data.posts) ? data.posts : [];
			cacheWrite(cacheKey, posts);
			return posts;
		} catch {
			return (cached && cached.data) || [];
		}
	}

	// Kept for callers that ask for Ziggit by name.
	function fetchZiggitPosts() {
		return fetchForumPosts('ziggit');
	}

	global.Site = {
		DOC,
		NAV_PAGES,
		initDoc,
		injectTitleBlock,
		injectToc,
		injectFooter,
		escapeHtml: esc,
		docDate,
		barcodeSVG,
		injectBarcodes,
		fault,
		fetchNotes,
		fetchDevtoArticles,
		fetchForumPosts,
		fetchZiggitPosts,
		fetchHNPosts
	};
})(window);
