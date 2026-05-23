/**
 * App-wide config. Override `API_BASE_URL` for staging/prod by editing
 * this file or wiring up `react-native-config` later.
 *
 * On Android emulators, `localhost` resolves to the emulator itself —
 * use 10.0.2.2 to reach the host machine instead.
 */

import { Platform } from "react-native";

const DEFAULT_DEV_API =
  Platform.OS === "android"
    ? "http://10.0.2.2:4000/api/v1"
    : "http://localhost:4000/api/v1";

export const API_BASE_URL = DEFAULT_DEV_API;
export const QUEUE_POLL_MS = 15_000;
