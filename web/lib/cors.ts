import { NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function corsResponse(data: any, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

export function corsOptions() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
