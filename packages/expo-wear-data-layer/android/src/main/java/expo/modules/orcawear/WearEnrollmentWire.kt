package expo.modules.orcawear

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

internal sealed interface EnrollmentPacket {
    val role: CompanionRole
    data class Hello(override val role: CompanionRole, val hello: EnrollmentHello) : EnrollmentPacket
    data class Confirmation(override val role: CompanionRole, val ciphertext: ByteArray) : EnrollmentPacket
    data class Binding(val ciphertext: ByteArray) : EnrollmentPacket { override val role = CompanionRole.PHONE }
}

internal object WearEnrollmentWire {
    const val PATH = "/orca/wear/v1/enrollment"

    fun encode(packet: EnrollmentPacket): ByteArray {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { output ->
            output.writeByte(1)
            output.writeByte(when (packet) {
                is EnrollmentPacket.Hello -> 1
                is EnrollmentPacket.Confirmation -> 2
                is EnrollmentPacket.Binding -> 3
            })
            output.writeByte(packet.role.ordinal)
            when (packet) {
                is EnrollmentPacket.Hello -> {
                    output.write(packet.hello.installId.toByteArray(Charsets.US_ASCII))
                    output.writeShort(packet.hello.publicKey.size)
                    output.write(packet.hello.publicKey)
                    output.write(packet.hello.nonce)
                }
                is EnrollmentPacket.Confirmation -> {
                    require(packet.ciphertext.size == 25)
                    output.write(packet.ciphertext)
                }
                is EnrollmentPacket.Binding -> {
                    require(packet.ciphertext.size == 84)
                    output.write(packet.ciphertext)
                }
            }
        }
        return bytes.toByteArray()
    }

    fun decode(bytes: ByteArray): EnrollmentPacket {
        require(bytes.size in 3..329)
        val input = DataInputStream(ByteArrayInputStream(bytes))
        require(input.readUnsignedByte() == 1)
        val kind = input.readUnsignedByte()
        val role = CompanionRole.entries.getOrNull(input.readUnsignedByte())
            ?: error("wear_enrollment_role_invalid")
        val packet = when (kind) {
            1 -> {
                val id = String(readBytes(input, 36), Charsets.US_ASCII)
                val size = input.readUnsignedShort()
                require(size in 64..256)
                EnrollmentPacket.Hello(role, EnrollmentHello(id, readBytes(input, size), readBytes(input, 32)))
            }
            2 -> EnrollmentPacket.Confirmation(role, readBytes(input, 25))
            3 -> {
                require(role == CompanionRole.PHONE)
                EnrollmentPacket.Binding(readBytes(input, 84))
            }
            else -> error("wear_enrollment_packet_unknown")
        }
        require(input.available() == 0)
        return packet
    }

    private fun readBytes(input: DataInputStream, size: Int) = ByteArray(size).also { input.readFully(it) }
}
