import argparse
import json
import os
import sys
from pathlib import Path


def _to_number(value, fallback=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _point(value):
    if isinstance(value, dict):
        return [_to_number(value.get("x")), _to_number(value.get("y"))]
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return [_to_number(value[0]), _to_number(value[1])]
    return [0.0, 0.0]


def _bbox_from_polygon(polygon):
    if not polygon:
        return {"x": 0, "y": 0, "width": 0, "height": 0}

    xs = [point[0] for point in polygon]
    ys = [point[1] for point in polygon]
    return {
        "x": min(xs),
        "y": min(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }


def _result_to_dict(result):
    if isinstance(result, dict):
        return result
    if hasattr(result, "json"):
        try:
            return json.loads(result.json)
        except Exception:
            pass
    if hasattr(result, "to_json"):
        try:
            payload = result.to_json()
            return payload if isinstance(payload, dict) else json.loads(payload)
        except Exception:
            pass
    if hasattr(result, "__dict__"):
        return dict(result.__dict__)
    return {}


def _line_from_text_and_poly(text, confidence, polygon):
    clean_polygon = [_point(point) for point in polygon]
    return {
        "text": str(text or "").strip(),
        "confidence": _to_number(confidence, None),
        "bbox": _bbox_from_polygon(clean_polygon),
        "polygon": clean_polygon,
    }


def _extract_lines(payload):
    lines = []
    data = payload.get("res", payload)

    rec_texts = data.get("rec_texts") or data.get("texts") or []
    rec_scores = data.get("rec_scores") or data.get("scores") or []
    rec_polys = (
        data.get("rec_polys")
        or data.get("dt_polys")
        or data.get("polys")
        or data.get("boxes")
        or []
    )

    if rec_texts:
        for index, text in enumerate(rec_texts):
            confidence = rec_scores[index] if index < len(rec_scores) else None
            polygon = rec_polys[index] if index < len(rec_polys) else []
            line = _line_from_text_and_poly(text, confidence, polygon)
            if line["text"]:
                lines.append(line)
        return lines

    for item in data.get("lines") or data.get("words") or data.get("results") or []:
        if isinstance(item, dict):
            polygon = item.get("polygon") or item.get("points") or item.get("box") or []
            line = _line_from_text_and_poly(
                item.get("text") or item.get("value") or item.get("label"),
                item.get("confidence") or item.get("score"),
                polygon,
            )
            if line["text"]:
                lines.append(line)
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            text_part = item[1]
            text = text_part[0] if isinstance(text_part, (list, tuple)) and text_part else ""
            confidence = text_part[1] if isinstance(text_part, (list, tuple)) and len(text_part) > 1 else None
            line = _line_from_text_and_poly(text, confidence, item[0])
            if line["text"]:
                lines.append(line)

    return lines


def _expand_inputs(inputs):
    images = []
    for item in inputs:
        path = Path(item)
        if path.is_dir():
            images.extend(sorted(
                child for child in path.iterdir()
                if child.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
            ))
        else:
            images.append(path)
    return images


def run_ocr(args):
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(
        lang=args.lang,
        ocr_version=args.ocr_version,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        return_word_box=False,
    )

    pages = []
    for index, image_path in enumerate(_expand_inputs(args.input), start=1):
        if not image_path.exists():
            raise FileNotFoundError(str(image_path))

        if hasattr(ocr, "predict"):
            result = ocr.predict(input=str(image_path))
        else:
            result = ocr.ocr(str(image_path), cls=False)

        result_items = result if isinstance(result, list) else [result]
        page_lines = []
        for item in result_items:
            page_lines.extend(_extract_lines(_result_to_dict(item)))

        pages.append({
            "pageNumber": index,
            "sourceImage": str(image_path),
            "lines": page_lines,
        })

    return {
        "ok": True,
        "engine": "paddleocr-python-runner",
        "pages": pages,
    }


def main():
    parser = argparse.ArgumentParser(description="Run PaddleOCR on rendered diagnostic images and write normalized JSON.")
    parser.add_argument("--input", "-i", nargs="+", required=True, help="PNG file(s) or a directory with rendered pages.")
    parser.add_argument("--output", "-o", required=True, help="Output JSON path.")
    parser.add_argument("--lang", default="german")
    parser.add_argument("--ocr-version", default="PP-OCRv5")
    args = parser.parse_args()

    try:
        result = run_ocr(args)
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, ensure_ascii=True, indent=2), encoding="utf-8")
        print(str(output_path))
        return 0
    except Exception as error:
        failure = {
            "ok": False,
            "engine": "paddleocr-python-runner",
            "error": type(error).__name__,
            "message": str(error),
            "fallbackHints": [
                "Try PaddleOCR/PaddlePaddle version pinning inside .venv-ocr.",
                "Try the CLI with --device cpu --enable_mkldnn False.",
                "Use tesseract.js or external Tesseract as a diagnosis-only fallback.",
            ],
        }
        output = getattr(args, "output", "")
        if output:
            output_path = Path(output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(failure, ensure_ascii=True, indent=2), encoding="utf-8")
        print(json.dumps(failure, ensure_ascii=True, indent=2), file=sys.stderr)
        return 2


if __name__ == "__main__":
    os.environ.setdefault("FLAGS_enable_pir_api", "0")
    raise SystemExit(main())
