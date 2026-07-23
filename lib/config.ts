/**
 * Feature flags. Compile-time constants — flip and redeploy.
 */

/**
 * Price history chart on the Zoeken screen.
 *
 * Logging of price lookups is ALWAYS on (see historyService), regardless
 * of this flag. The flag only gates the DISPLAY: while false the chart
 * renders nothing at all — no placeholder, and the Recharts bundle is
 * never even downloaded.
 *
 * While our own history is still thin (<2 days of lookups) the chart
 * falls back to the API's avg30/avg7/avg1/trend points, so there is
 * something meaningful to show from day 1.
 */
export const SHOW_PRICE_CHART = true;
