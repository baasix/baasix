/**
 * Spatial/GeoJSON Types
 * Types for geospatial data (PostGIS compatible)
 */

// ============================================================================
// GeoJSON Types
// ============================================================================

/**
 * GeoJSON Point
 */
export interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
}

/**
 * GeoJSON LineString
 */
export interface GeoJSONLineString {
  type: "LineString";
  coordinates: [number, number][];
}

/**
 * GeoJSON Polygon
 */
export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: [number, number][][];
}

/**
 * GeoJSON Geometry (union type)
 */
export type GeoJSONGeometry = GeoJSONPoint | GeoJSONLineString | GeoJSONPolygon;
