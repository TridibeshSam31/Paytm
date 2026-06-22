//in order to verify the user otp we will follow the followung flow 

/*

// POST body: { phone: "9999999999", otp: "123456" }
// 1. Find latest unused, non-expired OtpVerification for that phone
// 2. bcrypt.compare(otp, stored hash)
// 3. Mark as used
// 4. Find or create User with that phone number
// 5. Return a short-lived JWT token (sign with NEXTAUTH_SECRET)
//    → this token is what CredentialsProvider.authorize() will validate




*/


import { NextResponse, NextRequest } from "next/server"
import bcrypt from "bcrypt"
import PrismaClient from "@repo/db/client"
import jwt from "jsonwebtoken";


export async function POST(request: NextRequest){
    try{
        const {phoneNumber,otp} = await request.json()

        if(!phoneNumber || typeof phoneNumber !== "string" || phoneNumber.length !== 10){
            return NextResponse.json({error: "Invalid Phone Number"}, {status: 400})
        }

        if(!otp || typeof otp !== "string" || otp.length !== 6){
            return NextResponse.json({error: "Invalid OTP"}, {status: 400})
        }

        //find the latest unused, non-expired OtpVerification for that phone
        const otpRecord = await PrismaClient.otpVerification.findFirst({
            where:{
                phone:phoneNumber,
                used:false,
                expiresAt: {
                    gt: new Date()
                }
            }
        })

        if(!otpRecord){
            return NextResponse.json({error: "OTP not found or expired"}, {status: 400})
        }

        // Compare the provided OTP with the stored hash
        const isMatch = await bcrypt.compare(otp, otpRecord.otp)
        if(!isMatch){
            return NextResponse.json({error: "Invalid OTP"}, {status: 400})
        }

        // Mark the OTP as used
        await PrismaClient.otpVerification.update({
            where:{
                id: otpRecord.id
            },
            data:{
                used: true
            }
        })

        // Find or create a user with the provided phone number
        let user = await PrismaClient.user.findUnique({
            where:{
                number: phoneNumber
            }
        })

        if(!user){
            user = await PrismaClient.user.create({
                data:{
                    phone: phoneNumber
                }
            })
        }

        // Generate a short-lived JWT token
        const token = jwt.sign({ userId: user.id }, process.env.NEXTAUTH_SECRET as string, { expiresIn: "1h" })

        return NextResponse.json({ token })
    }catch(error){

        return NextResponse.json({error:"Otp verification Failed"},{status:500})

    }
}