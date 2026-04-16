/* ========================================
   GitHub activity helper
   - Direct /repos/{repo}/commits per repo (reliable)
   - Parallel fetch (fast)
   - 1hr localStorage cache with ETag conditional requests
   - Graceful fallback: if any repo fails, still show the rest
   ======================================== */

(function (global) {
	'use strict';

	const CACHE_KEY = 'gh_activity_cache_v3';
	const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
	const COMMITS_PER_REPO = 10;

	// All repos to surface across the site
	const REPOS = [
		{ full: 'fieldopt/FieldOpt', display: 'FieldOpt' },
		{ full: 'zblauser/hako',     display: 'hako' },
		{ full: 'zblauser/LoMux',    display: 'LoMux' },
		{ full: 'zblauser/cicada',   display: 'cicada' },
		{ full: 'zblauser/tymbal',   display: 'tymbal' },
		{ full: 'zblauser/sigil',    display: 'sigil' }
	];

	function readCache() {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object') return null;
			return parsed;
		} catch {
			return null;
		}
	}

	function writeCache(data) {
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(data));
		} catch { /* ignore */ }
	}

	function cacheIsFresh(cache) {
		if (!cache || !cache.fetchedAt) return false;
		return (Date.now() - cache.fetchedAt) < CACHE_TTL_MS;
	}

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
			if (res.status === 304) {
				return { notModified: true };
			}
			if (!res.ok) {
				return { error: true, status: res.status };
			}
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
		const cached = readCache();
		if (cached && cacheIsFresh(cached) && Array.isArray(cached.events)) {
			return { events: cached.events, fromCache: true };
		}

		const prevEtags = (cached && cached.etags) || {};
		const prevEventsByRepo = {};
		if (cached && Array.isArray(cached.events)) {
			for (const ev of cached.events) {
				if (!prevEventsByRepo[ev.repoFull]) prevEventsByRepo[ev.repoFull] = [];
				prevEventsByRepo[ev.repoFull].push(ev);
			}
		}

		// Parallel fetch, graceful degradation per-repo
		const results = await Promise.all(REPOS.map(repo =>
			fetchRepoCommits(repo, prevEtags[repo.full])
				.then(res => ({ repo, res }))
		));

		const allEvents = [];
		const newEtags = {};
		let anySucceeded = false;

		for (const { repo, res } of results) {
			if (res.notModified) {
				// Keep cached events for this repo
				if (prevEventsByRepo[repo.full]) {
					allEvents.push(...prevEventsByRepo[repo.full]);
				}
				newEtags[repo.full] = prevEtags[repo.full];
				anySucceeded = true;
			} else if (res.commits) {
				allEvents.push(...res.commits);
				if (res.etag) newEtags[repo.full] = res.etag;
				anySucceeded = true;
			} else if (prevEventsByRepo[repo.full]) {
				// Failed but we have old data — reuse it
				allEvents.push(...prevEventsByRepo[repo.full]);
				if (prevEtags[repo.full]) newEtags[repo.full] = prevEtags[repo.full];
			}
			// else: no data, skip silently
		}

		if (!anySucceeded && allEvents.length === 0) {
			if (cached && Array.isArray(cached.events)) {
				return { events: cached.events, fromCache: true, stale: true };
			}
			return { events: [], error: true };
		}

		// Sort newest first, cache, return
		allEvents.sort((a, b) => new Date(b.time) - new Date(a.time));
		writeCache({ fetchedAt: Date.now(), etags: newEtags, events: allEvents });
		return { events: allEvents, fromCache: false };
	}

	function timeAgo(dateStr) {
		const diff = (Date.now() - new Date(dateStr)) / 1000;
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
		return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

	global.GH = {
		fetchEvents,
		timeAgo,
		formatDate,
		truncate,
		escapeHtml,
		REPOS
	};
})(window);
