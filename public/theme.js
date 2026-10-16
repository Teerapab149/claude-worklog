// Applies a saved theme before the first paint, so the page never flashes the other one.
// It is a file of its own because the page allows no inline script.
try {
	const t = localStorage.getItem('worklog-theme');
	if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
}
catch {}
