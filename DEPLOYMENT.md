# Vercel Deployment Guide

## Frontend Deployment

### Option 1: Deploy via Vercel CLI

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Navigate to frontend directory:
```bash
cd frontend
```

3. Login to Vercel:
```bash
vercel login
```

4. Deploy:
```bash
vercel
```

5. For production deployment:
```bash
vercel --prod
```

### Option 2: Deploy via Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import from GitHub
4. Configure build settings:
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

5. Add Environment Variables (optional):
   - `VITE_API_URL`: Your backend API URL (if deploying backend separately)

### Project Structure

- Frontend: React + Vite application
- Backend: Python FastAPI (separate deployment recommended)
- Built-in songs work without backend
- API integration requires backend deployment

## Environment Variables

### Frontend (optional)
- `VITE_API_URL`: Backend API URL (e.g., `https://your-backend.vercel.app`)
- If not set, app works with built-in songs only

## Backend Deployment

The backend can be deployed separately on platforms like:
- **Vercel** (as serverless functions)
- **Railway**
- **Render**
- **Heroku**

### Backend Requirements
- Python 3.8+
- MongoDB database
- Dependencies listed in `backend/requirements.txt`

## Notes

- Frontend works independently with built-in songs
- Backend is required for:
  - Custom song uploads
  - YouTube to MusicXML conversion
  - MongoDB integration
- Audio samples are loaded from CDN (Tone.js)
- No additional configuration needed for basic piano functionality