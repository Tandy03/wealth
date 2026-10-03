// Compatibility facade: forms and controllers retain the existing api methods.
const apiFetchers = FinoFetchers.createService({ fetch: (...args) => window.fetch(...args) });
const api = FinoMobileApi.createFacade({
  desktop: FinoDesktopApi.createService(apiFetchers),
  mobile: FinoMobileApi.createService({ getAdapter: () => window.mobileApi, ...apiFetchers }),
  isNative: () => Boolean(window.mobileApi),
});
const readApiJson = FinoFetchers.readJson;
