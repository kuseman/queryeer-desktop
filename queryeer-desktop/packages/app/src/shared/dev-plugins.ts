/**
 * Passed to the window (`additionalArguments`) when developer plugin folders (`QUERYEER_DEV_PLUGINS`) are set, so the
 * preload can tell the renderer before the plugins activate. The renderer then shows Restart Backend and Reload in the status bar.
 */
export const DEV_PLUGINS_WINDOW_ARG = "--queryeer-dev-plugins";
