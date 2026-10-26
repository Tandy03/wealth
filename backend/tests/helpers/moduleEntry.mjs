// Test-only IIFE exports. The shipped browser entry never publishes this namespace.
export { createFrontend, sharedModules } from '../../../frontend/js/composition.js';
export { createMobileApi } from '../../../frontend/js/mobile-api.js';
export { createDataLoader } from '../../../frontend/js/data-loader.js';
export { createI18n } from '../../../frontend/js/i18n.js';
export { createRenderersDashboard } from '../../../frontend/js/renderers/dashboard.js';
