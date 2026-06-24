/*


What it does: Debit sender, credit receiver atomically.

so what we will do  id 

1.get current session (fromUserId)
2.Accept params: toPhoneNumber: string, amount: number (in paise)
4.validate the amount and toPhoneNumber
5.Find the receiver by number → if not found, throw error "User not found"
6.Use prisma.$transaction([...]) to do all 3 DB ops atomically:
prisma.balance.update → decrement sender's amount by amount (add where: { amount: { gte: amount } } to prevent going negative)
prisma.balance.update → increment receiver's amount by amount
prisma.p2pTransfer.create → record { fromUserId, toUserId, amount, timestamp: new Date() }

8.If the $transaction throws (insufficient funds), catch and return { error: "Insufficient balance" }
Return { success: true }




*/