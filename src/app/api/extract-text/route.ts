import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LENGTH = 50_000;

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ errors: ['multipart form data가 필요합니다.'] }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ errors: ['file 필드가 필요합니다.'] }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { errors: [`파일은 최대 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB까지 업로드할 수 있습니다.`] },
      { status: 413 },
    );
  }

  const fileName = file.name || 'uploaded-file';
  const fileType = file.type || inferMimeType(fileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (fileType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText().finally(() => parser.destroy());

      const text = normalizeExtractedText(parsed.text);

      if (!text) {
        return NextResponse.json(
          { errors: ['PDF에서 텍스트를 추출하지 못했습니다. 스캔 이미지 PDF라면 OCR이 필요합니다.'] },
          { status: 422 },
        );
      }

      return NextResponse.json({
        fileName,
        pageCount: parsed.total,
        text: text.slice(0, MAX_TEXT_LENGTH),
        truncated: text.length > MAX_TEXT_LENGTH,
      });
    }

    if (fileType.startsWith('text/') || /\.(txt|md|markdown)$/i.test(fileName)) {
      const text = normalizeExtractedText(buffer.toString('utf8'));

      return NextResponse.json({
        fileName,
        pageCount: null,
        text: text.slice(0, MAX_TEXT_LENGTH),
        truncated: text.length > MAX_TEXT_LENGTH,
      });
    }

    return NextResponse.json(
      { errors: ['지원하는 파일 형식은 PDF, TXT, MD입니다.'] },
      { status: 415 },
    );
  } catch (error) {
    console.error('[extract-text] file extraction failed:', error);

    return NextResponse.json(
      { errors: ['파일 텍스트 추출에 실패했습니다. 다른 파일로 다시 시도해 주세요.'] },
      { status: 500 },
    );
  }
}

function inferMimeType(fileName: string) {
  if (/\.pdf$/i.test(fileName)) {
    return 'application/pdf';
  }

  if (/\.(txt|md|markdown)$/i.test(fileName)) {
    return 'text/plain';
  }

  return 'application/octet-stream';
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
