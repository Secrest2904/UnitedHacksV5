export interface PoseData {
  file: string;
  alt?: string; // Optional alt text
}

export interface EmotionPoseMap {
  [emotion: string]: PoseData[];
}
