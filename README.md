# Estonian Natural Language Interface for SQL Databases, coded using large language models

## Running with Docker

Two Docker Compose configurations are provided. Both seed the database from `static/database_dump.sql` on first start.

### Production

Builds the frontend and backend, serves them behind nginx.

```bash
ENCRYPTION_KEY=your-secret-key docker compose up --build
```

The application is available at `http://localhost`.

### Development

Runs the backend with `tsx watch` (hot-reload) and the frontend with the Vite dev server, both with source code mounted from the host.

```bash
docker compose -f docker-compose.dev.yaml up --build
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:31869`

> **Note:** The first startup installs npm dependencies inside the container, which takes a moment. Subsequent starts are fast because the `node_modules_dev` volume is reused.

### Default test account

Both configurations seed a default administrator account on first run:

| Field    | Value             |
|----------|-------------------|
| Email    | admin@example.com |
| Password | admin1234         |
| Role     | Administrator     |

To reset the database (e.g. to re-seed), remove the named volume:

```bash
# production
docker compose down -v

# development
docker compose -f docker-compose.dev.yaml down -v
```

## Running locally without Docker

### Prerequisites

- Node.js and npm (this application was written with Node v25.2.1 and npm v11.6.2)
- A PostgreSQL database with the schema from `static/database_dump.sql` applied

### Step 1: Install dependencies

Run `npm install` in the root directory. This installs dependencies for both the frontend and backend workspaces.

### Step 2: Configure environment variables

#### Backend

Create `backend/.env`:

```
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_HOST=your_database_host
DB_NAME=your_database_name
DB_PORT=5432
PORT=31869
ENCRYPTION_KEY=your_encryption_key
```

#### Frontend

Create `.env` in the root directory:

```
VITE_API_URL=http://localhost:31869
```

### Step 3: Start the development server

```bash
npm run dev:all
```

- **Backend**: `http://localhost:31869`
- **Frontend**: `http://localhost:5173`

## Syncing database resources

After adding a database connection in the application, its schemas, tables, and columns must be synced into the app. This is done by the `backend/scripts/sync-db-resources.ts` script.

### Run manually

```bash
cd backend
npx tsx scripts/sync-db-resources.ts
```

Options:

| Flag | Description |
|------|-------------|
| `--dry-run`, `-n` | Preview what would be created without writing anything. |
| `--skip-connection-errors` | Skip databases that fail to connect and exit with code 0. |

Environment variable `CRON_APP_USER_ID` controls which user ID is used for auditing (defaults to `1`).

### Run as a cron job

To keep resources in sync automatically, schedule the script to run on a recurring basis. Example crontab entry that runs every hour:

```
0 * * * * cd /path/to/project/backend && npx tsx scripts/sync-db-resources.ts --skip-connection-errors >> /var/log/sync-db-resources.log 2>&1
```

Replace `/path/to/project` with the actual path to the repository. The `--skip-connection-errors` flag is recommended for unattended runs so that a temporarily unreachable database does not cause the job to fail.
