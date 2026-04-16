/* ========================================
   Shared site helpers
   - Nav injection (edit ONE array to rename/reorder site)
   - Footer injection
   - notes.json loader (one-liner transmissions)
   - dev.to feed
   ======================================== */

(function (global) {
	'use strict';

	const NOTES_CACHE_KEY = 'notes_cache_v1';
	const NOTES_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
	const DEVTO_CACHE_KEY = 'devto_cache_v1';
	const DEVTO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

	/* ==========================================================
	   NAV CONFIG — edit this to rename pages or change order.
	   `file` = the html filename, `label` = what's shown in nav.
	   The last entry (contact) is special-cased as the CTA.
	   ========================================================== */
	const NAV_PAGES = [
		{ file: 'index.html',    label: 'HOME' },
		{ file: 'projects.html', label: 'PROJECTS' },
		{ file: 'now.html',      label: 'NOW' },
		{ file: 'log.html',      label: 'LOG' },
		{ file: 'about.html',    label: 'ABOUT' },
		{ file: 'uses.html',     label: 'TOOLS' }
	];
	const CONTACT_EMAIL = 'zacharymblauser@gmail.com';

	// Which file is the current page? Derived from URL path.
	function currentFile() {
		const path = window.location.pathname;
		const seg = path.substring(path.lastIndexOf('/') + 1);
		return seg || 'index.html';
	}

	// --- NAV --------------------------------------------------------------

	function injectNav(opts) {
		opts = opts || {};
		const variant = opts.variant || 'top'; // 'top' for inner pages, 'home' for homepage dark block
		const here = currentFile();

		if (variant === 'home') {
			// Home page uses its own nav structure (.nav-block, already in index.html)
			// Just refresh labels from config
			const navEl = document.querySelector('.nav-block');
			if (!navEl) return;
			const existingContact = navEl.querySelector('.contact-cta');
			navEl.innerHTML = '';
			for (const page of NAV_PAGES) {
				if (page.file === 'index.html') continue; // skip self on home
				const a = document.createElement('a');
				a.href = page.file;
				a.textContent = page.label;
				navEl.appendChild(a);
			}
			const contact = document.createElement('a');
			contact.href = `mailto:${CONTACT_EMAIL}`;
			contact.className = 'contact-cta';
			contact.textContent = 'CONTACT';
			navEl.appendChild(contact);
			return;
		}

		// Inner page nav: find .top-nav and populate it
		const navEl = document.querySelector('.top-nav');
		if (!navEl) return;
		navEl.innerHTML = '';
		for (const page of NAV_PAGES) {
			const a = document.createElement('a');
			a.href = page.file;
			a.textContent = page.label;
			if (page.file === here) a.classList.add('nav-current');
			navEl.appendChild(a);
		}
		const contact = document.createElement('a');
		contact.href = `mailto:${CONTACT_EMAIL}`;
		contact.className = 'contact-cta';
		contact.textContent = 'CONTACT';
		navEl.appendChild(contact);
	}

	// --- FOOTER -----------------------------------------------------------

	function injectFooter(opts) {
		opts = opts || {};
		const year = new Date().getFullYear();
		const sig = opts.sig || '// transmission continues';
		const variant = opts.variant || 'default';

		const html = `
			<span class="footer-left">
				<span class="footer-year">© ${year} ZACHARY BLAUSER</span>
				<span class="footer-sep"> · </span>
				<a href="https://github.com/zblauser" target="_blank" rel="noopener">gh</a>
				<span class="footer-sep"> · </span>
				<a href="mailto:${CONTACT_EMAIL}">mail</a>
			</span>
			<span class="footer-sig">${sig}</span>
		`;

		const footer = document.createElement('footer');
		footer.className = variant === 'home' ? 'home-footer' : 'site-footer';
		footer.innerHTML = html;

		if (variant === 'home') {
			const container = document.querySelector('.container');
			if (container) container.appendChild(footer);
		} else {
			document.body.appendChild(footer);
		}
	}

	// --- NOTES ------------------------------------------------------------

	async function fetchNotes(url) {
		url = url || 'notes.json';

		try {
			const raw = localStorage.getItem(NOTES_CACHE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && (Date.now() - parsed.fetchedAt) < NOTES_CACHE_TTL_MS) {
					return parsed.notes || [];
				}
			}
		} catch { /* ignore */ }

		try {
			const res = await fetch(`${url}?_=${Date.now()}`);
			if (!res.ok) throw new Error('notes fetch failed');
			const data = await res.json();
			const notes = Array.isArray(data) ? data : (Array.isArray(data.notes) ? data.notes : []);
			try {
				localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), notes }));
			} catch { /* ignore */ }
			return notes;
		} catch {
			try {
				const raw = localStorage.getItem(NOTES_CACHE_KEY);
				if (raw) {
					const parsed = JSON.parse(raw);
					if (parsed && Array.isArray(parsed.notes)) return parsed.notes;
				}
			} catch { /* ignore */ }
			return [];
		}
	}

	// --- DEV.TO -----------------------------------------------------------

	async function fetchDevtoArticles(username) {
		username = username || 'zblauser';

		try {
			const raw = localStorage.getItem(DEVTO_CACHE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && (Date.now() - parsed.fetchedAt) < DEVTO_CACHE_TTL_MS) {
					return parsed.articles || [];
				}
			}
		} catch { /* ignore */ }

		try {
			const res = await fetch(`https://dev.to/api/articles?username=${username}&per_page=10`);
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

			try {
				localStorage.setItem(DEVTO_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), articles }));
			} catch { /* ignore */ }
			return articles;
		} catch {
			try {
				const raw = localStorage.getItem(DEVTO_CACHE_KEY);
				if (raw) {
					const parsed = JSON.parse(raw);
					if (parsed && Array.isArray(parsed.articles)) return parsed.articles;
				}
			} catch { /* ignore */ }
			return [];
		}
	}

	// --- RUST FORUM (Discourse-powered) ----------------------------------
	// users.rust-lang.org is Discourse. We try the JSON API directly.
	// If CORS is blocked, we fail silently — the log just won't include it.

	const RUST_CACHE_KEY = 'rust_cache_v1';
	const RUST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

	async function fetchRustForumPosts(username) {
		username = username || 'zblauser';

		// Cache check
		try {
			const raw = localStorage.getItem(RUST_CACHE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && (Date.now() - parsed.fetchedAt) < RUST_CACHE_TTL_MS) {
					return parsed.posts || [];
				}
			}
		} catch { /* ignore */ }

		try {
			// Discourse user_actions API: filter 4=new-topic, 5=reply
			const url = `https://users.rust-lang.org/user_actions.json?username=${encodeURIComponent(username)}&filter=4,5&limit=15`;
			const res = await fetch(url, { headers: { Accept: 'application/json' } });
			if (!res.ok) throw new Error(`rust forum fetch ${res.status}`);
			const data = await res.json();

			const actions = Array.isArray(data.user_actions) ? data.user_actions : [];
			const posts = actions.map(a => ({
				source: 'rust',
				repo: 'rust forum',
				title: a.title || '(untitled)',
				// 4 = new topic, 5 = reply; rest: pick sensible label
				kind: a.action_type === 4 ? 'posted topic' : 'replied',
				url: `https://users.rust-lang.org/t/${encodeURIComponent(a.slug || '')}/${a.topic_id}${a.post_number ? '/' + a.post_number : ''}`,
				time: a.created_at
			}));

			try {
				localStorage.setItem(RUST_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), posts }));
			} catch { /* ignore */ }
			return posts;
		} catch {
			// CORS blocked, offline, or no posts yet — fall back to stale cache if any
			try {
				const raw = localStorage.getItem(RUST_CACHE_KEY);
				if (raw) {
					const parsed = JSON.parse(raw);
					if (parsed && Array.isArray(parsed.posts)) return parsed.posts;
				}
			} catch { /* ignore */ }
			return [];
		}
	}

	global.Site = {
		injectNav,
		injectFooter,
		fetchNotes,
		fetchDevtoArticles,
		fetchRustForumPosts,
		NAV_PAGES
	};
})(window);
