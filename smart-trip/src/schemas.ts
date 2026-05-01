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
//
// type 说明（影响 Smart Trip UI 的"X Stops"计数器）：
//   - "location"      — 有店面/地标的具体地点（餐厅、博物馆、商店）。算 stop。
//   - "hotel_checkin" — 酒店入住。算 stop。
//   - "activity"      — 付费/预订的服务（导游、门票、SPA、餐厅预订）。算 stop。
//   - "note"          — 备忘条目，**默认不算 stop**（视为 reminder）。
//                       如果是真正的"事件"（路上感想、看日落、喂猫等无具体店面但确实
//                       发生过的事），可设 isEvent=true 让它算 stop。但通常 LLM 调用
//                       时**不要主动设 isEvent**——让用户在 UI 上自己决定。
//   - "list"          — 候选/分组（备选餐厅清单）。不算 stop。
//
// content 字段说明：
//   - type='note' 时 UI 渲染的正文是 `content` 字段（**不是** note 或 desc）。
//   - type='location' / 'activity' 等需要描述时用 `desc`。
export const stopShape = z.object({
  id: z.string().optional(),
  type: z
    .enum(['location', 'hotel_checkin', 'activity', 'note', 'list'])
    .optional()
    .describe(
      [
        'EXACTLY one of: "location" / "hotel_checkin" / "activity" / "note" / "list".',
        '"event" is NOT a valid type — for free-form events use type="note" with isEvent=true.',
        'Picking guide:',
        '  - real venue (restaurant/museum/store): "location"',
        '  - hotel arrival: "hotel_checkin"',
        '  - paid or booked service (tour/ticket/reservation/SPA): "activity"',
        '  - free informal happening (sunset, road trip moment, no specific place): "note" + isEvent=true',
        '  - reminder / pre-trip checklist item: "note" (leave isEvent unset)',
        '  - candidate group / shortlist: "list"',
      ].join(' '),
    ),
  location: z.string().describe('Place name or note title (UI shows this as the card heading)'),
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
  note: z.string().optional().describe('Short label / quick tag (legacy field, prefer `content` for note bodies)'),
  desc: z.string().optional().describe('Long description body — used for type=location/activity/hotel_checkin'),
  content: z
    .string()
    .optional()
    .describe('Note body — REQUIRED for type=note. Smart Trip UI renders this as the note text.'),
  checked: z
    .boolean()
    .optional()
    .describe('Checklist state for type=note (default false). UI may render notes as todo items.'),
  isEvent: z
    .boolean()
    .optional()
    .describe(
      'Only meaningful for type=note. true = this note represents a real event (counted in "X Stops"). false/missing = reminder (not counted). LLM should usually leave this unset and let the user toggle it in the UI.',
    ),
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

export const setNoteEventShape = {
  day_id: z.string(),
  stop_index: z.number().int().min(0).describe('Index of the note in stops_data'),
  is_event: z
    .boolean()
    .describe('true = count this note in "X Stops" (real event). false = reminder, not counted.'),
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
