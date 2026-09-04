/* ========================================
   GitHub data helper
   - Repo metadata comes from 4 account-level list calls, not one call
     per repo. Unauthenticated GitHub allows 60 req/hr per visitor IP,
     so request count is the budget that matters here.
   - Commits and releases still need per-repo calls; both lists are
     curated to active repos only.
   - ETag conditional requests + localStorage cache.
   - Per-repo graceful degradation: one failure never blanks the page.
   ======================================== */

(function (global) {
	'use strict';

	const CACHE_KEY = 'gh_activity_cache_v4';
	const CACHE_TTL_MS = 6 * 60 * 60 * 1000;          // 6 hours
	const COMMITS_PER_REPO = 10;

	const RELEASE_CACHE_KEY = 'gh_releases_cache_v2';
	const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours

	const INDEX_CACHE_KEY = 'gh_index_cache_v1';
	const INDEX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;    // 6 hours

	// The four accounts the work lives under. One request each returns
	// full metadata for every repo they own.
	const ACCOUNTS = [
		{ kind: 'users', name: 'zblauser' },
		{ kind: 'orgs',  name: 'mithraeums' },
		{ kind: 'orgs',  name: 'sys-ae' },
		{ kind: 'orgs',  name: 'vim-nvim-plugins' }
	];

	// Repos excluded from the index: infrastructure, not work.
	const INDEX_EXCLUDE = new Set([
		'mithraeums/.github',
		'zblauser/zblauser.github.io',
		'zblauser/homebrew-tap'
	]);

	// Commit feed. Curated — each entry is one request.
	const REPOS = [
		{ full: 'zblauser/hum',            display: 'hum' },
		{ full: 'zblauser/slyph',          display: 'slyph' },
		{ full: 'zblauser/felf',           display: 'felf' },
		{ full: 'zblauser/LoMux',          display: 'LoMux' },
		{ full: 'mithraeums/hako-code',    display: 'hako-code' },
		{ full: 'mithraeums/hako',         display: 'hako' },
		{ full: 'mithraeums/hako-edit',    display: 'hako-edit' },
		{ full: 'mithraeums/hako-studio',  display: 'hako-studio' },
		{ full: 'sys-ae/fieldopt',         display: 'fieldopt' },
		{ full: 'zblauser/tempo',          display: 'tempo' }
	];

	// Release feed. Also one request each.
	const RELEASE_REPOS = [
		{ full: 'zblauser/hum',           display: 'hum' },
		{ full: 'zblauser/slyph',         display: 'slyph' },
		{ full: 'zblauser/felf',          display: 'felf' },
		{ full: 'zblauser/LoMux',         display: 'LoMux' },
		{ full: 'mithraeums/hako-code',   display: 'hako-code' },
		{ full: 'mithraeums/hako',        display: 'hako' },
		{ full: 'mithraeums/hako-edit',   display: 'hako-edit' },
		{ full: 'sys-ae/fieldopt',        display: 'fieldopt' },
		{ full: 'vim-nvim-plugins/vibe',  display: 'vibe' },
		{ full: 'zblauser/cicada',        display: 'cicada' }
	];

	// --- CACHE ------------------------------------------------------------

	function readCache(key) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			return (parsed && typeof parsed === 'object') ? parsed : null;
		} catch {
			return null;
		}
	}

	function writeCache(key, data) {
		try {
			localStorage.setItem(key, JSON.stringify(data));
		} catch { /* quota or private mode — not fatal */ }
	}

	function isFresh(cache, ttl) {
		return !!(cache && cache.fetchedAt && (Date.now() - cache.fetchedAt) < ttl);
	}

	// --- RATE LIMIT -------------------------------------------------------
	// Unauthenticated GitHub allows 60 requests an hour per IP, and a cold
	// visit across cover, projects and log spends 24 of them. Once an IP is
	// out, every further page view used to re-attempt all of them and stay
	// out. This records the reset time the API reports and skips the network
	// entirely until it passes, so a limited visitor spends nothing and
	// renders from cache instead.
	//
	// Note: a 304 from a conditional request is still charged against the
	// limit. If-None-Match saves bandwidth here, not quota.

	const BACKOFF_KEY = 'gh_backoff_until_v1';

	function backoffActive() {
		try {
			const until = Number(localStorage.getItem(BACKOFF_KEY) || 0);
			if (!until) return false;
			if (Date.now() >= until) {
				localStorage.removeItem(BACKOFF_KEY);
				return false;
			}
			return true;
		} catch {
			return false;
		}
	}

	function noteRateLimit(res) {
		if (!res || res.status !== 403) return;
		const remaining = res.headers.get('x-ratelimit-remaining');
		if (remaining !== '0') return;
		const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
		try {
			localStorage.setItem(BACKOFF_KEY, String(reset || (Date.now() + 15 * 60 * 1000)));
		} catch { /* private mode — the fetch still fails safe */ }
	}

	// --- REPO INDEX -------------------------------------------------------
	// Four requests, full metadata for everything. This is what the spec
	// tables render from.

	async function fetchIndex() {
		const cached = readCache(INDEX_CACHE_KEY);
		if (isFresh(cached, INDEX_CACHE_TTL_MS) && Array.isArray(cached.repos)) {
			return { repos: cached.repos, fromCache: true };
		}
		if (backoffActive() && cached && Array.isArray(cached.repos)) {
			return { repos: cached.repos, fromCache: true, stale: true };
		}

		const failed = [];

		const results = await Promise.all(ACCOUNTS.map(async acct => {
			try {
				const url = `https://api.github.com/${acct.kind}/${acct.name}/repos?per_page=100&sort=pushed`;
				const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
				if (!res.ok) { noteRateLimit(res); failed.push(acct.name); return null; }
				const data = await res.json();
				if (!Array.isArray(data)) { failed.push(acct.name); return null; }
				return data.map(r => ({
					full: r.full_name,
					owner: acct.name,
					name: r.name,
					desc: r.description || '',
					lang: r.language || '—',
					stars: r.stargazers_count || 0,
					forks: r.forks_count || 0,
					license: (r.license && (r.license.spdx_id || r.license.key)) || '—',
					pushed: r.pushed_at,
					created: r.created_at,
					size: r.size || 0,
					archived: !!r.archived,
					fork: !!r.fork,
					url: r.html_url,
					homepage: r.homepage || ''
				}));
			} catch {
				failed.push(acct.name);
				return null;
			}
		}));

		const repos = results
			.filter(Boolean)
			.flat()
			.filter(r => !r.fork && !INDEX_EXCLUDE.has(r.full))
			.sort((a, b) => new Date(b.pushed) - new Date(a.pushed));

		if (repos.length === 0) {
			// Every account failed — serve stale rather than an empty page.
			if (cached && Array.isArray(cached.repos)) {
				return { repos: cached.repos, fromCache: true, stale: true, failed };
			}
			return { repos: [], error: true, failed };
		}

		// A partial failure must not look like "that account has no repos".
		if (failed.length) {
			return { repos, fromCache: false, partial: true, failed };
		}

		writeCache(INDEX_CACHE_KEY, { fetchedAt: Date.now(), repos });
		return { repos, fromCache: false, failed: [] };
	}

	// Convenience: index keyed by full name, for per-repo lookups.
	async function fetchIndexMap() {
		const { repos, error, stale } = await fetchIndex();
		const map = {};
		for (const r of repos) map[r.full] = r;
		return { map, repos, error, stale };
	}

	// --- COMMITS ----------------------------------------------------------

	function flattenCommits(commits, repoFull, repoDisplay) {
		const out = [];
		if (!Array.isArray(commits)) return out;
		const repoUrl = `https://github.com/${repoFull}`;

		for (const c of commits) {
			if (!c || !c.commit) continue;
			const msg = (c.commit.message || '').split('\n')[0];
			if (msg.startsWith('Merge ')) continue;
			out.push({
				type: 'commit',
				source: 'github',
				repo: repoDisplay,
				repoFull,
				repoUrl,
				sha: (c.sha || '').slice(0, 7),
				message: msg,
				body: (c.commit.message || '').split('\n').slice(2).join('\n').trim(),
				time: c.commit.author && c.commit.author.date,
				url: c.html_url
			});
		}
		return out;
	}

	async function fetchRepoCommits(repo, etag) {
		const url = `https://api.github.com/repos/${repo.full}/commits?per_page=${COMMITS_PER_REPO}`;
		const headers = { Accept: 'application/vnd.github+json' };
		if (etag) headers['If-None-Match'] = etag;

		try {
			const res = await fetch(url, { headers });
			if (res.status === 304) return { notModified: true };
			if (!res.ok) { noteRateLimit(res); return { error: true, status: res.status }; }
			const data = await res.json();
			return {
				commits: flattenCommits(data, repo.full, repo.display),
				etag: res.headers.get('etag') || null
			};
		} catch {
			return { error: true };
		}
	}

	async function fetchEvents() {
		const cached = readCache(CACHE_KEY);
		if (isFresh(cached, CACHE_TTL_MS) && Array.isArray(cached.events)) {
			return { events: cached.events, fromCache: true };
		}
		if (backoffActive() && cached && Array.isArray(cached.events)) {
			return { events: cached.events, fromCache: true, stale: true };
		}

		const prevEtags = (cached && cached.etags) || {};
		const prevEventsByRepo = {};
		if (cached && Array.isArray(cached.events)) {
			for (const ev of cached.events) {
				if (!prevEventsByRepo[ev.repoFull]) prevEventsByRepo[ev.repoFull] = [];
				prevEventsByRepo[ev.repoFull].push(ev);
			}
		}

		const results = await Promise.all(REPOS.map(repo =>
			fetchRepoCommits(repo, prevEtags[repo.full]).then(res => ({ repo, res }))
		));

		const allEvents = [];
		const newEtags = {};
		let anySucceeded = false;

		for (const { repo, res } of results) {
			if (res.notModified) {
				if (prevEventsByRepo[repo.full]) allEvents.push(...prevEventsByRepo[repo.full]);
				newEtags[repo.full] = prevEtags[repo.full];
				anySucceeded = true;
			} else if (res.commits) {
				allEvents.push(...res.commits);
				if (res.etag) newEtags[repo.full] = res.etag;
				anySucceeded = true;
			} else if (prevEventsByRepo[repo.full]) {
				allEvents.push(...prevEventsByRepo[repo.full]);
				if (prevEtags[repo.full]) newEtags[repo.full] = prevEtags[repo.full];
			}
		}

		if (!anySucceeded && allEvents.length === 0) {
			if (cached && Array.isArray(cached.events)) {
				return { events: cached.events, fromCache: true, stale: true };
			}
			return { events: [], error: true };
		}

		allEvents.sort((a, b) => new Date(b.time) - new Date(a.time));
		writeCache(CACHE_KEY, { fetchedAt: Date.now(), etags: newEtags, events: allEvents });
		return { events: allEvents, fromCache: false };
	}

	// --- RELEASES ---------------------------------------------------------

	async function fetchReleases() {
		const cached = readCache(RELEASE_CACHE_KEY);
		if (isFresh(cached, RELEASE_CACHE_TTL_MS) && Array.isArray(cached.releases)) {
			return { releases: cached.releases, fromCache: true };
		}
		if (backoffActive() && cached && Array.isArray(cached.releases)) {
			return { releases: cached.releases, fromCache: true, stale: true };
		}

		const results = await Promise.all(RELEASE_REPOS.map(async repo => {
			try {
				const res = await fetch(`https://api.github.com/repos/${repo.full}/releases/latest`, {
					headers: { Accept: 'application/vnd.github+json' }
				});
				if (!res.ok) { noteRateLimit(res); return null; }
				const data = await res.json();
				if (!data.tag_name) return null;
				return {
					repo: repo.display,
					repoFull: repo.full,
					tag: data.tag_name,
					name: data.name || '',
					body: releaseSummary(data.body, data.name, data.tag_name),
					time: data.published_at,
					url: data.html_url
				};
			} catch {
				return null;
			}
		}));

		const releases = results
			.filter(Boolean)
			.sort((a, b) => new Date(b.time) - new Date(a.time));

		if (releases.length === 0 && cached && Array.isArray(cached.releases)) {
			return { releases: cached.releases, fromCache: true, stale: true };
		}

		writeCache(RELEASE_CACHE_KEY, { fetchedAt: Date.now(), releases });
		return { releases, fromCache: false };
	}

	// GitHub release bodies are markdown and usually open with generated
	// boilerplate. Find the first line that actually says something.
	const BOILERPLATE = /^(what'?s changed|full changelog|changelog|release notes)\b/i;

	function releaseSummary(body, name, tag) {
		const lines = String(body || '').split('\n');
		for (let line of lines) {
			line = line
				.replace(/^\s*#{1,6}\s*/, '')      // heading marks
				.replace(/^\s*[-*+]\s+/, '')       // list bullets
				.replace(/\*\*(.*?)\*\*/g, '$1')   // bold
				.replace(/`([^`]*)`/g, '$1')       // code spans
				.replace(/\[(.*?)\]\((.*?)\)/g, '$1') // links
				.trim();
			if (!line || BOILERPLATE.test(line)) continue;
			if (/^https?:\/\//.test(line)) continue;
			return line;
		}
		// Nothing usable in the body — fall back to the release title.
		if (name && name !== tag) return name;
		return '—';
	}

	// --- FORMATTING -------------------------------------------------------

	function timeAgo(dateStr) {
		const diff = (Date.now() - new Date(dateStr)) / 1000;
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
		return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	// Datasheets date by ISO. Revision tables use this.
	function isoDate(dateStr) {
		if (!dateStr) return '—';
		const d = new Date(dateStr);
		if (isNaN(d)) return '—';
		const p = n => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}

	function formatDate(dateStr) {
		return new Date(dateStr).toLocaleDateString('en-US', {
			year: 'numeric', month: 'long', day: 'numeric'
		});
	}

	function truncate(s, n) {
		if (!s) return '';
		return s.length > n ? s.slice(0, n) + '…' : s;
	}

	function escapeHtml(s) {
		if (!s) return '';
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	// Pushed within the last 14 days flags a row NEW in the revision table.
	function isRecent(dateStr, days) {
		if (!dateStr) return false;
		const ms = (days || 14) * 86400000;
		return (Date.now() - new Date(dateStr)) < ms;
	}

	global.GH = {
		fetchIndex,
		fetchIndexMap,
		fetchEvents,
		fetchReleases,
		timeAgo,
		isoDate,
		formatDate,
		truncate,
		escapeHtml,
		isRecent,
		ACCOUNTS,
		REPOS,
		RELEASE_REPOS
	};
})(window);
