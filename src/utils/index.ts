export const getQueueName = (queue: "HISTORY" | "WEBHOOK" | "LLM" | "EMAIL") => {
    return `${queue}-QUEUE-${process.env.NODE_ENV}`
}