import "dotenv/config";
import { requireTestDatabaseUrl } from "./test-database";

// This module must precede all database/runtime imports in integration suites.
process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
