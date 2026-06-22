/*

// POST body: { phone, password, name }
// 1. Check phone not already taken
// 2. bcrypt.hash(password)
// 3. prisma.user.create({ number: phone, password: hash, Balance: { create: { amount: 0, locked: 0 } } })
// 4. Return 201

*/


import { NextResponse, NextRequest } from "next/server"
import bcrypt from "bcrypt"
import PrismaClient from "@repo/db/client"


export async function POST(request:NextRequest){
    try{
        const {phone,password,name} = await request.json()

        if(!phone || typeof phone !== "string" || phone.length !== 10){
            return NextResponse.json({error: "Invalid Phone Number"}, {status: 400})
        }

        if(!password || typeof password !== "string" || password.length < 6){
            return NextResponse.json({error: "Invalid Password"}, {status: 400})
        }

        if(!name || typeof name !== "string"){
            return NextResponse.json({error: "Invalid Name"}, {status: 400})
        }

        //check if phone already exists
        const existingUser = await PrismaClient.user.findUnique({
            where:{
                number:phone
            }

        })

        if(existingUser){
            return NextResponse.json({error: "Phone number already registered"}, {status: 400})
        }

        

        //hash the password

        const hashedPassword = await bcrypt.hash(password,10)

        //create the user in database with initial balance of 0

        await PrismaClient.user.create({
            data:{
                name,
                number:phone,
                password: hashedPassword,
                Balance:{
                    create:{
                        amount:0,
                        locked:0
                    }
                }

            }
        })

        return NextResponse.json({message: "User registered successfully"}, {status: 201})

    }catch{
        return NextResponse.json({error: "Invalid request body"}, {status: 400})

    }
}