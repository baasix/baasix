/**
 * Schema & Field Types
 * Shared across core, sdk, cli, and app packages
 */

// ============================================================================
// Field Types
// ============================================================================

/**
 * Supported field types in Baasix
 */
export type FieldType =
  | "String"
  | "Text"
  | "HTML"
  | "Integer"
  | "BigInt"
  | "Float"
  | "Real"
  | "Double"
  | "Decimal"
  | "Boolean"
  | "Date"
  | "DateTime"
  | "Time"
  | "UUID"
  | "SUID"
  | "JSON"
  | "JSONB"
  | "Array"
  | "Geometry"
  | "Point"
  | "LineString"
  | "Polygon"
  | "Enum";

/**
 * Default value types supported by Baasix
 */
export type DefaultValueType =
  | { type: "UUIDV4" }
  | { type: "SUID" }
  | { type: "NOW" }
  | { type: "AUTOINCREMENT" }
  | { type: "SQL"; value: string }
  | { type: "CURRENT_USER" }
  | { type: "CURRENT_TENANT" };

/**
 * Field validation rules
 */
export interface FieldValidationRules {
  /** Minimum value for numeric fields */
  min?: number;
  /** Maximum value for numeric fields */
  max?: number;
  /** Validate as integer */
  isInt?: boolean;
  /** Validate email format */
  isEmail?: boolean;
  /** Validate URL format */
  isUrl?: boolean;
  /** Validate IP address format */
  isIP?: boolean;
  /** Validate UUID format */
  isUUID?: boolean;
  /** String must not be empty */
  notEmpty?: boolean;
  /** String length range [min, max] */
  len?: [number, number];
  /** Pattern matching with regex */
  is?: string;
  /** Pattern matching with regex (alias for is) */
  matches?: string;
  /** @deprecated Use 'is' or 'matches' instead */
  regex?: string;
}

/**
 * Field values configuration (for type-specific options)
 */
export interface FieldValues {
  /** String length (varchar) */
  length?: number;
  /** String length (alias for length) */
  stringLength?: number;
  /** Decimal precision */
  precision?: number;
  /** Decimal scale */
  scale?: number;
  /** Array element type */
  type?: string;
  /** Enum values */
  values?: string[];
  /** Spatial reference system identifier (for geometry types) */
  srid?: number;
}

/**
 * Field definition
 * Note: `type` is optional because relation fields use `relType` instead
 */
export interface FieldDefinition {
  /** Field type (required for data fields, not used for relation fields) */
  type?: FieldType | string;
  primaryKey?: boolean;
  allowNull?: boolean;
  unique?: boolean;
  /**
   * Default value for the field
   * Can be a static value or a dynamic type
   */
  defaultValue?: DefaultValueType | string | number | boolean | null | unknown[] | Record<string, unknown>;
  /** Field values configuration (for type-specific options like length, precision, enum values) */
  values?: FieldValues;
  validate?: FieldValidationRules;
  comment?: string;
  /** Field description for documentation */
  description?: string;
  /** Relation type (if this is a relation field) */
  relType?: RelationshipType | string;
  /** Target collection for relations */
  target?: string;
  /** Alias for relation (used in queries) */
  as?: string;
  /** Display format for relations */
  showAs?: string;
  /** Foreign key field name or boolean indicating it's a foreign key */
  foreignKey?: string | boolean;
  /** Target key for relations */
  targetKey?: string;
  /** Junction table name for M2M (or junction config object) */
  through?: string | Record<string, unknown>;
  /** Other key in junction table */
  otherKey?: string;
  /** Display format string */
  displayFormat?: string;
  /** Display options */
  displayOptions?: Record<string, unknown>;
  /** Calculated field expression */
  calculated?: string;
  /** Hide field from API responses */
  hidden?: boolean;
  /** Mark field as system-generated (not user-editable) */
  SystemGenerated?: string | boolean;
  /** Whether to add constraints */
  constraints?: boolean;
  /** Delete behavior for relations */
  onDelete?: "CASCADE" | "RESTRICT" | "SET NULL" | string;
  /** Update behavior for relations */
  onUpdate?: "CASCADE" | "RESTRICT" | "SET NULL" | string;
  /** Whether this is a polymorphic relation (M2A) */
  polymorphic?: boolean;
  /** Target tables for polymorphic (M2A) relations */
  tables?: string[];
}

/**
 * Flattened field info (used in core services)
 */
export interface FlattenedField {
  name: string;
  type: FieldType;
  allowNull?: boolean;
  unique?: boolean;
  primaryKey?: boolean;
  defaultValue?: unknown;
  validate?: FieldValidationRules;
  relType?: RelationshipType;
  target?: string;
}

/**
 * Field info with full metadata
 */
export interface FieldInfo extends FlattenedField {
  path: string;
  isRelation: boolean;
  isNested: boolean;
}

// ============================================================================
// Schema Types
// ============================================================================

/**
 * Index definition
 */
export interface IndexDefinition {
  /** Index name (auto-generated if not provided) */
  name?: string;
  fields: string[];
  unique?: boolean;
  /** When true, NULL values are considered equal for unique indexes (PostgreSQL 15+) */
  nullsNotDistinct?: boolean;
  type?: "btree" | "hash" | "gin" | "gist";
}

/**
 * Schema definition
 */
export interface SchemaDefinition {
  name: string;
  timestamps?: boolean;
  paranoid?: boolean;
  sortEnabled?: boolean;
  /**
   * Track user who created/updated records (adds createdBy_Id, updatedBy_Id)
   */
  usertrack?: boolean;
  /**
   * True for M2M/M2A junction tables (system-generated)
   */
  isJunction?: boolean;
  fields: Record<string, FieldDefinition>;
  indexes?: IndexDefinition[];
}

/**
 * Schema info (full schema with collection name)
 */
export interface SchemaInfo {
  collectionName: string;
  schema: SchemaDefinition;
  relationships?: RelationshipDefinition[];
}

/**
 * Validation result (generic base)
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Field validation result
 */
export interface FieldValidation extends ValidationResult {
  fieldName: string;
}

/**
 * Schema validation result
 */
export interface SchemaValidation extends ValidationResult {
  collectionName: string;
  fieldValidations?: FieldValidation[];
}

// ============================================================================
// Relationship Types
// ============================================================================

/**
 * Relationship types
 * - M2O: Many-to-One (creates foreign key with auto-index)
 * - O2M: One-to-Many (virtual reverse of M2O)
 * - O2O: One-to-One (creates foreign key with unique constraint)
 * - M2M: Many-to-Many (creates junction table)
 * - M2A: Many-to-Any (polymorphic junction table)
 *
 * Legacy aliases (deprecated, use M2O/O2M/M2M/O2O instead):
 * - BelongsTo: alias for M2O
 * - HasMany: alias for O2M
 * - HasOne: alias for O2O
 * - BelongsToMany: alias for M2M
 */
export type RelationshipType =
  | "M2O"
  | "O2M"
  | "M2M"
  | "M2A"
  | "O2O"
  // Legacy aliases for backward compatibility
  | "BelongsTo"
  | "HasMany"
  | "HasOne"
  | "BelongsToMany";

/**
 * Association type (alias for RelationshipType)
 */
export type AssociationType = RelationshipType;

/**
 * Relationship definition
 */
export interface RelationshipDefinition {
  type: RelationshipType;
  target: string;
  name: string;
  alias?: string;
  /**
   * Custom junction table name for M2M/M2A relationships
   */
  through?: string;
  onDelete?: "CASCADE" | "RESTRICT" | "SET NULL";
  onUpdate?: "CASCADE" | "RESTRICT" | "SET NULL";
  /** Target tables for M2A (polymorphic) relationships */
  tables?: string[];
}

/**
 * Association definition (used internally in core)
 */
export interface AssociationDefinition {
  type: AssociationType;
  foreignKey?: string;
  sourceKey?: string;
  targetKey?: string;
  through?: string;
  as?: string;
  target: string;
  onDelete?: "CASCADE" | "RESTRICT" | "SET NULL";
  onUpdate?: "CASCADE" | "RESTRICT" | "SET NULL";
}

/**
 * Include configuration for relation fetching
 */
export interface IncludeConfig {
  model: string;
  as?: string;
  attributes?: string[];
  where?: Record<string, unknown>;
  required?: boolean;
  include?: IncludeConfig[];
}

/**
 * Processed include (after parsing)
 */
export interface ProcessedInclude {
  association: string;
  as: string;
  attributes?: string[];
  where?: Record<string, unknown>;
  required?: boolean;
  include?: ProcessedInclude[];
}
