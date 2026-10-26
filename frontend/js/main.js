import Chart from '../vendor/chart.umd.js';
import config from './mobile-config.generated.js';
import { createFrontend } from './composition.js';

const application = createFrontend(window, { Chart, config });
const start = () => application.init().then(() => {
  document.documentElement.dataset.startup = 'ready';
}).catch(error => {
  console.error('Frontend startup failed:', application.FinoErrors.diagnostics(error));
  document.documentElement.dataset.startup = 'failed';
});
if (document.readyState === 'complete') void start();
else document.addEventListener('DOMContentLoaded', start, { once: true });
