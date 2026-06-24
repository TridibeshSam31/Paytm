/*



1. Get session → userId
2.Accept params: amount: number, bankRef?: string

3.Validate: amount > 0
4.

prisma.$transaction([...]):
prisma.balance.update → decrement amount AND increment locked by the withdrawal amount (where: { amount: { gte: amount } })
prisma.withdrawal.create({ userId, amount, status: "pending", bankRef })
Return { success: true }








*/