# WebP Compression Demo Results

This page demonstrates the image compression and UI capabilities of the [WebP Attachment Component](../README.md).

## Image Compression Savings

The component converts images to WebP format **before upload**, reducing storage costs by up to 95%.

### Before & After Comparison

| Original JPG (5MB) | WebP @80% quality (KB) |
|--------|-----------|
| <img src="./original.jpg" width="700" style="display:inline-block" alt="Image 1"> | <img src="./reduced_80.webp" width="700" style="display:inline-block" alt="Image 2"> |





**Result:** 5.27 MB → 56 KB (**91% reduction**, ~4.9 MB saved)

> **Note**: The component defaults to 80% quality (our best value/size tradeoff). At 80% we demonstrate the lower end of our compression curve while maintaining visual fidelity.

## UI Comparison: WebP Component vs Budibase Native

### Empty State (Drag-and-Drop Zone)

![`screenshot1.png`](./screenshot1.png)

**Left:** WebP Attachment Component showing the drag-and-drop zone and file picker button.  
**Right:** Budibase native upload component for comparison.

The WebP component provides a modern, clean interface that converts images to WebP format automatically—no JavaScript library required on your frontend.

### With File Selected

![`screenshot2.png`](./screenshot2.png)

Shows both components after selecting the same test image. The WebP component begins automatic compression (converting to WebP) while preserving the visual appearance of a standard file input, but with significantly reduced upload sizes and CDN costs.


## Use Cases

1. **Photo galleries**: Convert 5MB camera imports to ~700KB without visible quality loss when using large canvas and high quality %.
2. **Form attachments**: Reduce attachments storage by 90%+ while maintaining crisp display
3. **Mobile uploads**: Save mobile data during upload and reduce CDN costs on your side
4. **CDN optimization**: Smaller payloads mean faster edge delivery times

## Technical Details

- **Conversion happens client-side** using Canvas API (no server processing)
- **Smart skipping**: Files below xxxKB are skipped to save CPU cycles
- **Resizing**: Images larger than `maxWidth`×`maxHeight` are scaled before conversion
- **Format support**: JPG, PNG, GIF, BMP → WebP

## Configuration Options

See [`README.md`](../README.md) for full reference including:

```js
<Component.webpAttachment 
  field={field}
  webpQuality={85}      // Lower = smaller files (0-100)
  minSizeToCompress={500}  // Skip tiny files to save CPU time
  maxWidth={2000}           // Resize oversized images
/>
```

## License

MIT
