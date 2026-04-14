export interface Vector3Payload {
  x: number;
  y: number;
  z: number;
}

export interface ContainerPayload {
  id?: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  amount: number;
  color?: string;
  position?: Vector3Payload;
}

export interface ContainerResponse extends Required<Pick<ContainerPayload, 'id'>> {
  id: string;
  layout_id: string;
  width: number;
  length: number;
  height: number;
  weight: number;
  amount: number;
  color?: string;
  position: Vector3Payload;
  created_at: string;
}

export interface LayoutSummary {
  id: string;
  name: string;
  description?: string;
  container_count: number;
  created_at: string;
  updated_at: string;
}

export interface LayoutResponse {
  id: string;
  name: string;
  description?: string;
  containers: ContainerResponse[];
  created_at: string;
  updated_at: string;
}

export interface LayoutCreatePayload {
  name: string;
  description?: string;
  containers?: ContainerPayload[];
}

export interface LayoutUpdatePayload {
  name?: string;
  description?: string;
}

export interface ContainerBulkSavePayload {
  containers: ContainerPayload[];
}

export interface ContainerUpdatePayload {
  width?: number;
  length?: number;
  height?: number;
  weight?: number;
  amount?: number;
  color?: string;
  position?: Vector3Payload;
}
