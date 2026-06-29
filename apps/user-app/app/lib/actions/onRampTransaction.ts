"use server"

/*


what we will do here is that we wiill create a pending
transaction record and later return a token that bank will use to confirm the transaction 



1.check whether the user is authenticated or not 
2.Accept params: amount: number, provider: string (e.g. "HDFC Bank")
3.validate the amount and provider
4.Generate a unique token 
5.prisma.onRampTransaction.create({ userId, amount, provider, token, status: "Processing", startTime: new Date() })

6.Return { token } — this token is what you'd send to the bank's payment gateway









*/

import {PrismaClient} from "@repo/db"
import {getSession} from "@repo/auth"


export async function onRampTransaction(amount:Number,provider:string){
    const session = await getSession();
    const user = session.user

    if(!user){
        throw new Error("User not authenticated")
    }

    


}
