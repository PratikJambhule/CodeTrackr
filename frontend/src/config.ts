/**
 * Where the website sends API requests.
 *
 * Production: '' = the website's own address. Vercel forwards /api/* and /auth/*
 * to the Render backend (frontend/vercel.json), so the browser only ever talks to
 * one site and the login cookie is first-party. Calling Render directly made it a
 * third-party cookie, which Safari, Firefox, Brave and private windows block (H-19).
 *
 * Development (npm run dev, Docker Compose): the local API on port 5050, or
 * VITE_API_URL if set.
 */
export const API_URL = import.meta.env.PROD
	? ''
	: import.meta.env.VITE_API_URL ||
		import.meta.env.VITE_LOCAL_API_URL ||
		'http://localhost:5050';
