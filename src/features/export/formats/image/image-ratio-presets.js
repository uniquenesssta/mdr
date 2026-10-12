/** One immutable pixel-size authority shared by request validation and image layout. */
export const EXPORT_IMAGE_RATIOS = Object.freeze(Object.fromEntries([
  ['9:16', 1080, 1920], ['4:5', 1080, 1350], ['3:4', 1080, 1440],
  ['1:1', 1080, 1080], ['16:9', 1920, 1080]
].map(([ratio, width, height]) => [ratio, Object.freeze({ width, height })])));
