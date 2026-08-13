/**
 * BetaBanner
 * A continuously-scrolling marquee banner reminding users that this app is
 * in beta and they should keep a manual backup of important data.
 *
 * Mounted globally at the app root so it appears on every screen
 * (Dashboard, Attendance, Login, Paywall, Owner Portal, etc.).
 *
 * Design:
 *  - Background: #FFF9C4 (soft warm yellow — attention without alarm)
 *  - Text: #333333 (readable dark grey)
 *  - Fixed at very top of the viewport, above the app content
 *  - Sets CSS var --beta-banner-h on <html> so sticky headers can offset
 *  - Respects prefers-reduced-motion (falls back to a static message)
 */
import { useEffect } from "react";

const BETA_MESSAGE =
  "ಗಮನಿಸಿ: ಈ ಅಪ್ಲಿಕೇಶನ್ ಪರೀಕ್ಷಾ ಹಂತದಲ್ಲಿದೆ, ದಯವಿಟ್ಟು ಪ್ರಮುಖ ಲೆಕ್ಕಾಚಾರಗಳನ್ನು ಮ್ಯಾನುಯಲ್ ಆಗಿ ಬರೆದಿಟ್ಟುಕೊಳ್ಳಿ. / Note: This app is in beta phase. Please maintain a manual backup of your important data.";

const BANNER_HEIGHT_PX = 30;

export default function BetaBanner() {
  // Expose banner height as a CSS variable so sticky headers can offset by it.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--beta-banner-h",
      `${BANNER_HEIGHT_PX}px`
    );
    return () => {
      document.documentElement.style.removeProperty("--beta-banner-h");
    };
  }, []);

  return (
    <>
      {/* The fixed marquee itself */}
      <div
        data-testid="beta-banner"
        role="status"
        aria-live="polite"
        className="beta-banner-wrap"
        style={{
          backgroundColor: "#FFF9C4",
          color: "#333333",
          height: `${BANNER_HEIGHT_PX}px`,
        }}
      >
        <div className="beta-banner-track">
          <span className="beta-banner-item">{BETA_MESSAGE}</span>
          <span className="beta-banner-item" aria-hidden="true">
            {BETA_MESSAGE}
          </span>
        </div>
      </div>

      {/* Spacer so page content is not covered by the fixed banner */}
      <div
        aria-hidden="true"
        style={{ height: `${BANNER_HEIGHT_PX}px`, flexShrink: 0 }}
      />

      <style>{`
        .beta-banner-wrap {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 60;
          overflow: hidden;
          white-space: nowrap;
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          font-size: 12px;
          line-height: 1;
          font-weight: 500;
          letter-spacing: 0.01em;
          display: flex;
          align-items: center;
        }
        .beta-banner-track {
          display: inline-flex;
          gap: 3rem;
          padding-left: 100%;
          animation: beta-banner-scroll 42s linear infinite;
          will-change: transform;
        }
        .beta-banner-item {
          flex-shrink: 0;
        }
        @keyframes beta-banner-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .beta-banner-track {
            animation: none;
            padding-left: 0;
            white-space: normal;
            display: block;
            text-align: center;
            padding: 0 12px;
            line-height: 1.25;
          }
          .beta-banner-item + .beta-banner-item { display: none; }
        }
      `}</style>
    </>
  );
}
