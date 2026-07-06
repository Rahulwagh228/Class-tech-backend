import type { Request, Response } from 'express';
import pool from '../../config/connectpsql.js';
import type {
  SuperadminDashboardRecentTution,
  SuperadminDashboardResponse
} from '../../models/Superadmin.model.js';

interface MetricRow {
  total_tutions: string;
  active_admins: string;
  platform_users: string;
}

interface DashboardRequest extends Request {
  superadmin?: {
    id: string;
    role: 'superadmin';
  };
}

export const getSuperadminDashboard = async (
  req: DashboardRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.superadmin) {
      res.status(401).json({ msg: 'Authentication required' });
      return;
    }

    const [metricsRes, recentTutionsRes] = await Promise.all([
      pool.query<MetricRow>(
        `SELECT
           COUNT(*) AS total_tutions,
           (SELECT COUNT(*) FROM users WHERE role = 'admin') AS active_admins,
           (SELECT COUNT(*) FROM users) AS platform_users
         FROM Tutions`
      ),
      pool.query<SuperadminDashboardRecentTution>(
        `SELECT id, name, slug, timezone, created_at, updated_at
           FROM Tutions
          ORDER BY created_at DESC, updated_at DESC
          LIMIT 5`
      )
    ]);

    const metrics = metricsRes.rows[0];

    const response: SuperadminDashboardResponse = {
      metrics: {
        total_tutions: Number(metrics?.total_tutions ?? 0),
        active_admins: Number(metrics?.active_admins ?? 0),
        platform_users: Number(metrics?.platform_users ?? 0),
        total_earned: {
          value: 250000,
          currency: 'INR',
          is_static: true,
          note: 'Revenue tracking is not implemented yet'
        }
      },
      recently_added_tutions: recentTutionsRes.rows,
      generated_at: new Date().toISOString()
    };

    res.status(200).json(response);
  } catch (err) {
    console.error('getSuperadminDashboard error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
};