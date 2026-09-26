package expo.modules.orcawear

import org.junit.Assert.*
import org.junit.Test

class WearEnrollmentWireTest {
    @Test fun roundTripsAndRejectsAmbiguousOrOversizedPackets() {
        val hello = EnrollmentHello("00000000-0000-4000-8000-000000000001", ByteArray(91) { it.toByte() }, ByteArray(32))
        val encoded = WearEnrollmentWire.encode(EnrollmentPacket.Hello(CompanionRole.WATCH, hello))
        val decoded = WearEnrollmentWire.decode(encoded) as EnrollmentPacket.Hello
        assertEquals(CompanionRole.WATCH, decoded.role)
        assertEquals(hello.installId, decoded.hello.installId)
        assertArrayEquals(hello.publicKey, decoded.hello.publicKey)
        assertThrows(IllegalArgumentException::class.java) { WearEnrollmentWire.decode(encoded + byteArrayOf(0)) }
        assertThrows(IllegalArgumentException::class.java) { WearEnrollmentWire.decode(ByteArray(330)) }
        assertThrows(IllegalArgumentException::class.java) { WearEnrollmentWire.decode(encoded.copyOf().also { it[0] = 2 }) }
        val binding = WearEnrollmentWire.encode(EnrollmentPacket.Binding(ByteArray(84)))
        assertThrows(IllegalArgumentException::class.java) {
            WearEnrollmentWire.decode(binding.copyOf().also { it[2] = CompanionRole.WATCH.ordinal.toByte() })
        }
        assertThrows(java.io.EOFException::class.java) { WearEnrollmentWire.decode(binding.copyOf(binding.size - 1)) }
    }
}
