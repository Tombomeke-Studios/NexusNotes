//! The policy pages bundled with the app (`public/legal/`) open in a window of
//! their own: a native webview ignores `target="_blank"`. Only this command
//! creates those windows, and only for a fixed list of pages; the webview has
//! no permission to create windows itself, and no capability names the
//! `legal-*` windows, so the pages get no Tauri permissions.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The bundled policy pages: name, path inside the app, window title.
const POLICY_PAGES: &[(&str, &str, &str)] = &[
    ("privacy", "legal/privacy.html", "Privacy Policy"),
    ("terms", "legal/terms.html", "Terms of Service"),
    ("cookies", "legal/cookies.html", "Cookie Policy"),
    ("refund", "legal/refund.html", "Refund Policy"),
];

/// The window that may open policy pages.
const MAIN_WINDOW: &str = "main";

/// Path and title of a bundled policy page, or None for any other name.
pub fn policy_page(name: &str) -> Option<(&'static str, &'static str)> {
    POLICY_PAGES
        .iter()
        .find(|(n, _, _)| *n == name)
        .map(|(_, path, title)| (*path, *title))
}

/// Same scheme, host and port. `Url::origin` does not fit here: the app's own
/// `tauri://localhost` origin (macOS, Linux) is opaque and never equals itself.
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Whether a policy window may load `url`: one of the bundled policy pages on
/// the app's own origin (the pages link to each other). Everything else, the
/// app itself and every other site included, is blocked: such a link does
/// nothing.
pub fn is_policy_navigation(url: &Url, app_origin: &Url) -> bool {
    if !same_origin(url, app_origin) || url.query().is_some() {
        return false;
    }
    POLICY_PAGES
        .iter()
        .any(|(_, path, _)| url.path() == format!("/{path}"))
}

/// Opens (or focuses) the policy window for `name`. Only the main window may
/// ask, and only for a page on the list; the URL is built here, never taken
/// from the caller. Async: creating a window from a sync command can deadlock
/// on Windows.
#[tauri::command]
pub async fn open_policy_page(
    app: AppHandle,
    webview_window: WebviewWindow,
    name: String,
) -> Result<(), String> {
    if webview_window.label() != MAIN_WINDOW {
        return Err("not available in this window".into());
    }
    let (path, title) = policy_page(&name).ok_or("unknown policy page")?;
    let label = format!("legal-{name}");
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let app_origin = webview_window.url().map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(path.into()))
        .title(title)
        .inner_size(760.0, 820.0)
        .center()
        .on_navigation(move |url| is_policy_navigation(url, &app_origin))
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn knows_only_the_bundled_pages() {
        assert_eq!(
            policy_page("terms"),
            Some(("legal/terms.html", "Terms of Service"))
        );
        assert_eq!(
            policy_page("privacy").map(|p| p.0),
            Some("legal/privacy.html")
        );
        assert_eq!(
            policy_page("cookies").map(|p| p.0),
            Some("legal/cookies.html")
        );
        for name in [
            "",
            "index",
            "../index",
            "terms.html",
            "legal/terms",
            "Terms",
            "terms ",
            "https://example.com",
        ] {
            assert_eq!(policy_page(name), None, "{name}");
        }
    }

    #[test]
    fn every_listed_page_is_bundled() {
        let public = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public");
        for (name, path, _) in POLICY_PAGES {
            assert!(public.join(path).is_file(), "{name}: {path} is missing");
        }
    }

    #[test]
    fn policy_windows_stay_on_the_policy_pages() {
        // Production (Windows, then macOS/Linux) and the dev server.
        for origin in [
            "http://tauri.localhost/",
            "tauri://localhost/",
            "http://localhost:1420/",
        ] {
            let origin = url(origin);
            let base = origin.as_str().trim_end_matches('/');
            assert!(is_policy_navigation(
                &url(&format!("{base}/legal/terms.html")),
                &origin
            ));
            assert!(is_policy_navigation(
                &url(&format!("{base}/legal/cookies.html")),
                &origin
            ));
            assert!(is_policy_navigation(
                &url(&format!("{base}/legal/privacy.html#contact")),
                &origin
            ));
            // The app itself and anything not on the list.
            for path in [
                "/",
                "/index.html",
                "/legal/",
                "/legal/legal.css",
                "/legal/other.html",
                "/legal/terms.html?x=1",
            ] {
                assert!(
                    !is_policy_navigation(&url(&format!("{base}{path}")), &origin),
                    "{path}"
                );
            }
        }
    }

    #[test]
    fn policy_windows_never_leave_the_app() {
        let origin = url("http://tauri.localhost/");
        for target in [
            "https://example.com/legal/terms.html",
            "http://tauri.localhost.example.com/legal/terms.html",
            "http://localhost:1420/legal/terms.html",
            "https://tauri.localhost/legal/terms.html",
            "tauri://localhost/legal/terms.html",
            "file:///C:/legal/terms.html",
            "mailto:privacy@example.com",
            "data:text/html,hi",
        ] {
            assert!(!is_policy_navigation(&url(target), &origin), "{target}");
        }
        let origin = url("tauri://localhost/");
        for target in [
            "tauri://example.com/legal/terms.html",
            "http://tauri.localhost/legal/terms.html",
        ] {
            assert!(!is_policy_navigation(&url(target), &origin), "{target}");
        }
    }
}
