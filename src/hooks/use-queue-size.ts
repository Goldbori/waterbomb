import { useEffect, useState } from "react";
import { queueSize, subscribeQueue } from "@/lib/offline-queue";

export function useQueueSize() {
  const [size, setSize] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void queueSize().then((n) => {
        if (mounted) setSize(n);
      });
    };
    refresh();
    const unsub = subscribeQueue(refresh);
    return () => {
      mounted = false;
      unsub();
    };
  }, []);
  return size;
}
