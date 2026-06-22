//what we need to do here is 

/*


// POST body: { phone: "9999999999" }
// 1. Generate random 6-digit OTP
// 2. Hash it with bcrypt
// 3. Save to OtpVerification table (delete old ones for same phone first)
// 4. Send SMS via Twilio/MSG91
// 5. Return { message: "OTP sent" }






*/

import { NextResponse, NextRequest } from "next/server"
import bcrypt from "bcrypt"
import PrismaClient from "@repo/db/client"
import twilio from "twilio";



export async function POST(request: NextRequest) {
    try{
  const { phoneNumber } = await request.json()

  if (!phoneNumber || typeof phoneNumber !== "string" || phoneNumber.length !== 10) {
    return NextResponse.json({ error: "Invalid Phone Number" }, { status: 400 })

  }

  //generate a random 6 digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString()

  //hash the otp with bcrypt
  const hashedOtp = await bcrypt.hash(otp, 10);

  //save the hashed otp to the database with the phone number (delete old ones for the same phone first)

  await PrismaClient.otpVerification.deleteMany({
    where: {
      phone: phoneNumber
    }
  })

  //create new otp entry
  await PrismaClient.otpVerification.create({
    data: {
      phone: phoneNumber,
      otp: hashedOtp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes expiry
    }
  })

  //send the otp via sms using twillo/msg91  or SMTP
  const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
  ); 


  await twilioClient.messages.create({
      body: `Your PayFlow OTP is: ${otp}. Valid for 10 minutes. Do not share this with anyone.`,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: phoneNumber,
    });

  return NextResponse.json(
      { message: "OTP sent successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("OTP send error:", error);
    return NextResponse.json(
      { message: "Failed to send OTP" },
      { status: 500 }
    );
    }
}

