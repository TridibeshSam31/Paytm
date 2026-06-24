/*



Get session → userId
prisma.p2pTransfer.findMany with:
where: { OR: [{ fromUserId: userId }, { toUserId: userId }] }
orderBy: { timestamp: "desc" }
include: { fromUser: { select: { name, number } }, toUser: { select: { name, number } } }
Map results to add a type: "sent" | "received" field based on fromUserId === userId
Return the array





*/

