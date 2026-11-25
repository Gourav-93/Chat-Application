import { useEffect, useRef, useState } from "react";

export default function useLocationSelection() {
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const clear = () => {
    generation.current++;
    setLocation(null);
    setLocating(false);
    setError("");
  };
  const request = () => {
    const attempt = ++generation.current;
    setError("");
    if (!window.isSecureContext || !navigator.geolocation) {
      setError("Location requires HTTPS or localhost and a browser with location support.");
      return;
    }
    setLocating(true);
    const fail = (failure) => {
      if (attempt !== generation.current) return;
      setLocating(false);
      setError(failure.code === 1
        ? "Location permission denied. Allow location in your browser settings, then retry."
        : failure.code === 3
          ? "Finding your location timed out. Please retry."
          : "Your location is unavailable. Check device location settings and retry.");
    };
    try {
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        if (attempt !== generation.current) return;
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) ||
            Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) {
          fail({ code: 2 });
          return;
        }
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setLocating(false);
      }, fail, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } catch { fail({ code: 2 }); }
  };
  return { location, locating, error, request, clear };
}
