# Petalcore Index

Petalcore Index is the plant-library frontend for Petalcore Platform. It reads the live plant catalog, searches it, and displays plant details and database-backed photos through the shared Platform API.

## Data and security

- Plant records and uploaded images are stored by the shared Platform API and cloud database.
- The page loads its public Index client key from `/config/index`; it contains no database or admin credentials.
- Record creation, updates, and deletion stay in Platform's protected admin tools.
- This project no longer carries a second in-memory API or a duplicate plant catalog.

## Use

Open Petalcore Platform and choose **Index**. To deploy this frontend separately, set the Vercel project root to `api/`, keep `PETALCORE_API_ORIGIN` in `api/config.js` pointed at the Platform deployment, and allow that frontend's origin in the Platform API's `ALLOWED_ORIGINS` setting.
