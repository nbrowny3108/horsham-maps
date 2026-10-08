import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppErrorComponent } from "@/lib/error-component";
import { BOOT_GUARD_SOURCE } from "@/lib/maps/boot-guard";
import appCss from "../styles.css?url";

const APP_NAME = "Horsham Maps";
const host = import.meta.env.VITE_PUBLIC_HOSTNAME;
const ogImage = host ? `https://${host}/og.jpg` : undefined;

export const Route = createRootRoute({
  errorComponent: AppErrorComponent,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=overlays-content",
      },
      { title: APP_NAME },
      {
        name: "description",
        content: "Standalone maps app for Horsham: search streets, drop pins, live GPS, and Horsham Rural City overlay.",
      },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "theme-color", content: "#d0d3d6" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
      ...(ogImage
        ? [
            { property: "og:image", content: ogImage },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
          ]
        : []),
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning style={{ height: "100%", background: "#d0d3d6" }}>
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: BOOT_GUARD_SOURCE }} />
        <HeadContent />
      </head>
      <body style={{ margin: 0, background: "#d0d3d6", height: "100%", minHeight: "100%" }}>
        <noscript>
          <main
            style={{
              boxSizing: "border-box",
              minHeight: "100dvh",
              padding: "2.5rem 1.25rem",
              background: "#fff",
              color: "#202124",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <h1 style={{ fontSize: "1.35rem" }}>Horsham Maps needs JavaScript</h1>
            <p>Turn JavaScript on for this site, then open it again.</p>
          </main>
        </noscript>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
