// Canonical demo seed: npx tsx --conditions=react-server scripts/seed-demo.ts
import "dotenv/config";
import { provisionDemo } from "@/lib/seed/demo";
provisionDemo().then((id) => { console.log(`[seed] demo operator ${id} ready`); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
