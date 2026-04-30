import { z } from 'zod';

// ── 工具入参 zod shapes（v1 SDK 用 raw shape，不包 z.object） ──

export const listTripsShape = {} as const;

export const getTripShape = {
  trip_id: z.string().describe('Trip id, e.g. "trip-1234567890"'),
} as const;

export const createTripShape = {
  title: z.string().min(1).describe('Trip title, e.g. "东京 5 月之旅"'),
  start_date: z.string().describe('YYYY-MM-DD'),
  end_date: z.string().describe('YYYY-MM-DD'),
  thumb: z.string().url().optional().describe('Cover image URL'),
} as const;

export const updateTripShape = {
  trip_id: z.string(),
  title: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  thumb: z.string().url().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
} as const;

export const deleteTripShape = {
  trip_id: z.string(),
} as const;

export const addDayToTripShape = {
  trip_id: z.string(),
  date: z.string().describe('YYYY-MM-DD'),
  title: z.string().optional(),
  color: z.string().optional().describe('Hex color, e.g. "#5b7a99"'),
} as const;

export const updateDayShape = {
  day_id: z.string(),
  title: z.string().optional(),
  color: z.string().optional(),
  date: z.string().optional(),
} as const;

export const removeDayShape = {
  day_id: z.string(),
} as const;

// stops_data JSONB 数组里每个 stop 的形状（参考 docs/database_migration_plan.md 的 stops 表字段）
export const stopShape = z.object({
  id: z.string().optional(),
  type: z.string().optional().describe('"location" / "note" / "list" / "hotel_checkin"'),
  location: z.string().describe('Place name or note title'),
  lat: z.number().optional(),
  lng: z.number().optional(),
  placeId: z.string().optional().describe('Google Places place_id'),
  category: z.string().optional(),
  categoryIcon: z.string().optional(),
  rating: z.number().optional(),
  photo: z.string().optional(),
  time: z.string().optional(),
  period: z.string().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  note: z.string().optional(),
  desc: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  transitMode: z.enum(['DRIVE', 'WALK', 'TRANSIT']).optional(),
});

export const addStopShape = {
  day_id: z.string(),
  stop: stopShape,
} as const;

export const updateStopShape = {
  day_id: z.string(),
  stop_index: z.number().int().min(0),
  fields: stopShape.partial(),
} as const;

export const removeStopShape = {
  day_id: z.string(),
  stop_index: z.number().int().min(0),
} as const;

export const reorderStopsShape = {
  day_id: z.string(),
  from_index: z.number().int().min(0).describe('Current position of the stop'),
  to_index: z.number().int().min(0).describe('Target position. Indices refer to the array BEFORE the move.'),
} as const;

export const addStopsBulkShape = {
  day_id: z.string(),
  stops: z.array(stopShape).min(1).describe('Stops appended in the given order'),
} as const;

export const cloneTripShape = {
  source_trip_id: z.string().describe('Trip to clone'),
  new_title: z.string().min(1).describe('Title for the cloned trip'),
  new_start_date: z
    .string()
    .describe(
      'YYYY-MM-DD. All days are shifted by (new_start_date - source.start_date) so dates do not collide with the source. REQUIRED — days_v2 has UNIQUE(user_id, date), so cloning to overlapping dates would conflict.',
    ),
  new_thumb: z.string().url().optional().describe('Cover image URL for the new trip; defaults to source.thumb'),
} as const;

export const searchPlacesShape = {
  query: z.string().min(1).describe('Place name or address fragment'),
  limit: z.number().int().min(1).max(50).optional().default(10),
} as const;
