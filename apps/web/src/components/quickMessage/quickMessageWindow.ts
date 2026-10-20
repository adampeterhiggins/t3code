import { isElectron } from "~/env";

/**
 * The desktop quick message panel loads this app in its own window. It shares the main window's
 * storage, so it must not run the main window's background work, which writes drafts and
 * settings, or its coordinators, which would act on links and notifications a second time.
 */
export const isQuickMessageWindow =
  isElectron && typeof window !== "undefined" && window.location.hash.startsWith("#/quick-message");
