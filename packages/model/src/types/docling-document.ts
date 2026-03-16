// Common reference type used across the document
export interface DoclingReference {
  $ref: string;
}

// Coordinate and position information (Bounding Box)
export interface DoclingBBox {
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin: 'BOTTOMLEFT' | 'TOPLEFT' | string;
}

// Source/location information (Provenance)
export interface DoclingProv {
  page_no: number;
  bbox: DoclingBBox;
  charspan: [number, number];
}

// Document origin information
export interface DoclingOrigin {
  mimetype: string;
  binary_hash: number;
  filename: string;
}

// Base node structure (common fields)
export interface DoclingBaseNode {
  self_ref: string;
  parent?: DoclingReference; // May not exist for top-level nodes (body, furniture)
  children: DoclingReference[];
  content_layer: string;
  label?: string;
}

// Text item (Texts)
export interface DoclingTextItem extends DoclingBaseNode {
  label:
    | 'text'
    | 'section_header'
    | 'list_item'
    | 'footnote'
    | 'caption'
    | 'page_footer'
    | 'page_header'
    | string;
  prov: DoclingProv[];
  orig: string;
  text: string;
  // Optional properties
  level?: number; // Present when label is section_header
  enumerated?: boolean; // Present for list_item; true = ol, false = ul
  marker?: string; // Present for list_item
}

// Group item (Groups)
export interface DoclingGroupItem extends DoclingBaseNode {
  name: 'list' | 'group' | string;
  label: 'list' | 'key_value_area' | string;
}

// Image item (Pictures)
export interface DoclingPictureItem extends DoclingBaseNode {
  label: 'picture' | string;
  prov: DoclingProv[];
  captions: DoclingReference[];
  references: any[]; // any[] if structure is undefined, otherwise specific type
  footnotes: any[];
  annotations: any[];
}

// Table cell information (Table Cell)
export interface DoclingTableCell {
  bbox: DoclingBBox;
  row_span: number;
  col_span: number;
  start_row_offset_idx: number;
  end_row_offset_idx: number;
  start_col_offset_idx: number;
  end_col_offset_idx: number;
  text: string;
  column_header: boolean;
  row_header: boolean;
  row_section: boolean;
  fillable: boolean;
}

// Table data (Table Data)
export interface DoclingTableData {
  table_cells: DoclingTableCell[];
  num_rows: number;
  num_cols: number;
  grid: DoclingTableCell[][]; // 2D array grid
}

// Table item (Tables)
export interface DoclingTableItem extends DoclingBaseNode {
  label: 'table' | 'document_index' | string;
  prov: DoclingProv[];
  captions: DoclingReference[];
  references: any[];
  footnotes: DoclingReference[];
  data: DoclingTableData;
}

// Document body (Body) and furniture (Furniture - headers/footers etc) structure
export interface DoclingBody extends DoclingBaseNode {
  name: '_root_' | string;
  label: 'unspecified' | string;
}

// Page image information
export interface DoclingPageImage {
  mimetype: string;
  dpi: number;
  size: {
    width: number;
    height: number;
  };
  uri: string;
}

// Page information
export interface DoclingPage {
  size: {
    width: number;
    height: number;
  };
  image: DoclingPageImage;
  page_no: number;
}

// Full document structure (Root)
export interface DoclingDocument {
  schema_name: 'DoclingDocument' | string;
  version: string;
  name: string;
  origin: DoclingOrigin;
  furniture: DoclingBody; // Structure similar to Body
  body: DoclingBody;
  groups: DoclingGroupItem[];
  texts: DoclingTextItem[];
  pictures: DoclingPictureItem[];
  tables: DoclingTableItem[];
  pages: Record<string, DoclingPage>;
}
