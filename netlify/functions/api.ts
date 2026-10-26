import serverless from "serverless-http";

import app from "../../src/app.js";

/**
 * Адаптує спільний Express-застосунок до формату Netlify Functions.
 * Маршрути, валідація й побічні ефекти залишаються в app; цей entrypoint лише передає запит адаптеру.
 */
export const handler = serverless(app);
