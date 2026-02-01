import sql from "mssql";

let pool: sql.ConnectionPool | null = null;

export async function connectToDatabase() {
    const config: sql.config = {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        server: process.env.DB_HOST || "localhost",
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT || "1433"),
        options: {
            encrypt: process.env.DB_ENCRYPT === "true", // Use this if you're on Azure or require encryption
            trustServerCertificate: process.env.DB_TRUST_CERT === "true", // Change to true for local dev / self-signed certs
        },
    };

    console.error("Connecting with config:", {
        ...config,
        password: config.password ? "*****" + config.password.slice(-3) : undefined
    });

    try {
        pool = await sql.connect(config);
        console.error("Connected to MSSQL database");
    } catch (err) {
        console.error("Database connection failed:", err);
        throw err;
    }
}

export async function getPool(): Promise<sql.ConnectionPool> {
    if (!pool) {
        throw new Error("Database not connected");
    }
    return pool;
}

export async function closeDatabase() {
    if (pool) {
        await pool.close();
        pool = null;
    }
}
