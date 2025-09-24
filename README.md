# Dynasty DNA

Dynasty fantasy football analytics platform built with Next.js, PostgreSQL, and deployed on Vercel.

## Local Development

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL database (recommend [Neon](https://neon.tech) for managed hosting)

### Setup
1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/jrygrande/dynasty-dna.git
   cd dynasty-dna
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Add your DATABASE_URL to .env
   ```

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. **Verify setup:**
   - Visit: http://localhost:3000/api/health
   - Should show: `{"status":"ok","db":"ok"}`

## Production Deployment (Vercel)

### Current Production URL
🚀 **https://dynasty-t5m7w25zl-jrygrandes-projects.vercel.app**

### Deploy New Changes
The app is configured for automatic deployment from the `main` branch. To deploy:

```bash
git add .
git commit -m "your changes"
git push origin main
```

Vercel will automatically build and deploy your changes.

### Manual Deployment (Vercel CLI)
If you need to deploy manually:

```bash
# Install Vercel CLI (if not installed)
npm i -g vercel@latest

# Login (first time only)
vercel login

# Deploy to production
vercel --prod
```

### Environment Variables
The following environment variables are configured in Vercel:
- `DATABASE_URL`: PostgreSQL connection string (Neon)

To add/update environment variables:
```bash
vercel env add VARIABLE_NAME production
vercel env ls  # List all variables
```

### Configuration Files
- **`vercel.json`**: Vercel deployment settings (framework, regions, API timeouts)
- **`.vercelignore`**: Files excluded from deployment
- **`.vercel/`**: Auto-generated Vercel project configuration (git-ignored)

### Database
- **Production database**: Neon PostgreSQL
- **Connection**: Automatic via `DATABASE_URL` environment variable
- **Migrations**: Run via Drizzle (`npm run db:migrate`)

## Architecture
- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL with Drizzle ORM
- **Deployment**: Vercel
- **Styling**: Tailwind CSS + shadcn/ui components
