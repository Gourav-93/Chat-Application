import { useContext, useState, useCallback } from "react";
import { MapPin, ExternalLink } from "lucide-react";
import { ThemeContext } from "../../../app/ThemeContext";

export default function MessageLocation({ location }) {
  const theme = useContext(ThemeContext);
  const [failed, setFailed] = useState(false);
  const previewRef = useCallback((frame) => {
    if (!frame) return;
    // iframe errors are not consistently surfaced by browsers. Keep the
    // coordinates/action outside the frame even when no error event arrives.
    const fail = () => setFailed(true);
    frame.addEventListener("error", fail);
    return () => frame.removeEventListener("error", fail);
  }, []);
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) return null;
  const { latitude, longitude } = location;
  const coordinates = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
  const bbox = [Math.max(-180, longitude - 0.006), Math.max(-90, latitude - 0.004),
    Math.min(180, longitude + 0.006), Math.min(90, latitude + 0.004)].join(",");
  const previewUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${latitude},${longitude}`;
  return <div className={"mb-2 w-72 max-w-full overflow-hidden rounded-xl border " +
    ((theme?.isDark ?? true) ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900")}>
    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label="Open current location in Maps"
      className="block focus-visible:outline-2 focus-visible:outline-blue-500">
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-slate-200 text-slate-600">
        <div className="flex flex-col items-center gap-2 text-xs"><MapPin size={30} />
          <span>{failed ? "Map preview unavailable" : "Current location"}</span></div>
        {!failed && <iframe ref={previewRef} title="Current location map preview" src={previewUrl} loading="lazy"
          referrerPolicy="no-referrer" tabIndex={-1} aria-hidden="true"
          onError={() => setFailed(true)} className="pointer-events-none absolute inset-0 h-full w-full border-0" />}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><MapPin size={18} className="text-emerald-500" /> Current location</div>
        <p className="mt-1 text-xs opacity-75">{coordinates}</p>
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold">Open in Maps <ExternalLink size={13} /></p>
      </div>
    </a>
    <div className="px-3 pb-2 text-[10px] opacity-75">Map preview: <a href="https://www.openstreetmap.org/copyright"
      target="_blank" rel="noopener noreferrer" className="underline">© OpenStreetMap contributors</a></div>
  </div>;
}
