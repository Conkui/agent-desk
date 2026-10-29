import { useEffect, useState } from "react";
export function usePage() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const changed = () => setPath(location.pathname);
    addEventListener("popstate", changed);
    return () => removeEventListener("popstate", changed);
  }, []);
  return {
    path,
    navigate: (path: string) => {
      history.pushState(null, "", path);
      setPath(path);
    },
  };
}
